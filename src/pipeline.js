// ================================================================
// PIPELINE v6.0 — Routes /api/scan et /api/status
// v6 additions : GitHub, Serper/Tavily fallback, Wayback, EmailRep,
//                RDAP, SecurityTrails, SMTP direct, MX fingerprint,
//                pattern stats, reverse cross-check, DNC, role-based.
// ================================================================
const { KEYS, TIMEOUTS, GENERIC_LOCAL_PARTS, SCORING } = require('./config');
const { parseName, extractDomain, normalize, log, sleep, shouldReadUrl, fetchWithTimeout } = require('./helpers');
const { sseLog, sseProgress, sseDone } = require('./sse');
const { checkMX } = require('./providers/dns');
const { checkGravatar } = require('./providers/gravatar');
const { jinaSearch, jinaRead } = require('./providers/jina');
const { serperSearch } = require('./providers/serper');
const { tavilySearch } = require('./providers/tavily');
const { bingSearch } = require('./providers/bing');
const { hunterFinder, hunterDomain, hunterVerify } = require('./providers/hunter');
const { snovFindEmail } = require('./providers/snov');
const { apolloFindPerson } = require('./providers/apollo');
const { pappersSearch } = require('./providers/pappers');
const { abstractVerify } = require('./providers/abstract');
const { githubFindUser, githubSearchCommitsByDomain } = require('./providers/github');
const { waybackContactPages } = require('./providers/wayback');
const { emailRepCheck } = require('./providers/emailrep');
const { rdapLookup } = require('./providers/rdap');
const { securitytrailsSubdomains } = require('./providers/securitytrails');
const { companiesHouseSearch } = require('./providers/companies-house');
const { smtpVerifyEmail } = require('./providers/smtp-direct');
const { detectCatchAll, resolveDomain, extractDomainHintsFromUrls, guessRegionalDomains, checkMXBatch } = require('./domain-resolver');
const { extractContactsContextual } = require('./extractors');
const { generateEmailPatterns } = require('./predictions');
const { reprioritizeByStats, detectIndustry } = require('./pattern-stats');
const { fingerprintMX } = require('./mx-fingerprint');
const { addCandidate, findCandidate } = require('./candidates');
const { computeScores } = require('./scoring');
const { generateDorks } = require('./dorks');
const { isDnc } = require('./dnc');
const { getDomainCache, setDomainCache } = require('./cache');

// ================================================================
// Multi-engine search : Jina → Serper → Tavily → Bing (fallback chain)
// Le 1er moteur qui retourne ≥1 résultat gagne.
// ================================================================
async function multiSearch(query, options = {}) {
    const engines = [
        { name: 'Jina', fn: () => jinaSearch(query, options), enabled: !!KEYS.jina },
        { name: 'Serper', fn: () => serperSearch(query, options), enabled: !!KEYS.serper },
        { name: 'Tavily', fn: () => tavilySearch(query, options), enabled: !!KEYS.tavily },
        { name: 'Bing', fn: () => bingSearch(query, options), enabled: !!KEYS.bing },
    ];
    let lastError = null;
    for (const eng of engines) {
        if (!eng.enabled) continue;
        try {
            const r = await eng.fn();
            if (Array.isArray(r) && r.length > 0) return { results: r, engine: eng.name };
        } catch (e) { lastError = e; log(`${eng.name} search error: ${e.message}`); }
    }
    if (lastError) throw lastError;
    return { results: [], engine: null };
}

// ================================================================
// GET /api/status
// ================================================================
async function statusRoute(req, res) {
    const status = {
        version: '6.0',
        apis: {
            jina: { configured: !!KEYS.jina },
            hunter: { configured: !!KEYS.hunter, quota: null },
            snov: { configured: !!(KEYS.snovId && KEYS.snovSecret) },
            apollo: { configured: !!KEYS.apollo },
            pappers: { configured: !!KEYS.pappers, quota: null },
            abstract: { configured: !!KEYS.abstract, note: KEYS.hunter ? 'fallback (Hunter prioritaire)' : null },
            github: { configured: !!KEYS.github, rateLimit: KEYS.github ? '5000/h' : '60/h (no auth)' },
            serper: { configured: !!KEYS.serper },
            tavily: { configured: !!KEYS.tavily },
            bing: { configured: !!KEYS.bing },
            emailrep: { configured: !!KEYS.emailrep, rateLimit: KEYS.emailrep ? '1000/j' : '100/j (no auth)' },
            securitytrails: { configured: !!KEYS.securitytrails },
            companieshouse: { configured: !!KEYS.companieshouse },
        }
    };

    if (KEYS.hunter) {
        try {
            const r = await fetchWithTimeout(`https://api.hunter.io/v2/account?api_key=${KEYS.hunter}`, {}, TIMEOUTS.HUNTER);
            const data = await r.json();
            if (data.data?.requests) {
                status.apis.hunter.quota = {
                    searches: { used: data.data.requests.searches.used, available: data.data.requests.searches.available },
                    verifications: { used: data.data.requests.verifications.used, available: data.data.requests.verifications.available },
                };
            }
        } catch (e) { log(`Status Hunter error: ${e.message}`); }
    }
    if (KEYS.pappers) {
        try {
            const r = await fetchWithTimeout(`https://api.pappers.fr/v2/suivi-jetons?api_token=${KEYS.pappers}`, {}, TIMEOUTS.PAPPERS);
            const data = await r.json();
            if (data.jetons_restants !== undefined) status.apis.pappers.quota = { remaining: data.jetons_restants };
        } catch (e) { log(`Status Pappers error: ${e.message}`); }
    }
    res.json(status);
}

// ================================================================
// POST /api/scan — Pipeline Steps 0-12
// ================================================================
async function scanRoute(req, res) {
    const { fullname, company } = req.body;
    if (!fullname || !company) return res.status(400).json({ error: 'fullname et company requis' });
    if (!KEYS.jina && !KEYS.serper && !KEYS.tavily && !KEYS.bing) {
        return res.status(400).json({ error: 'Au moins un moteur de recherche requis (JINA_API_KEY, SERPER_API_KEY, TAVILY_API_KEY ou BING_SEARCH_KEY)' });
    }

    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });

    const scanStart = Date.now();
    const name = parseName(fullname);
    let domain = extractDomain(company);
    const candidates = [];
    const allDomains = new Map();
    let hunterPattern = null;
    let hunterPatternSource = null;
    let apolloTitle = null;
    let pappersInfo = null;
    const sources = [];
    const exhaustedApis = new Set();
    const TOTAL_STEPS = 12;

    sseLog(res, `Recherche : "<strong>${name.firstOg} ${name.lastOg}</strong>" chez "<strong>${company}</strong>" → ${name.first}.${name.last}@...`, 'info');

    try {
        // ========================================
        // STEP 0: PAPPERS (FR) + Companies House (UK)
        // ========================================
        sseProgress(res, 0, TOTAL_STEPS, 'Résolution entreprise...');
        if (KEYS.pappers && !company.includes('.')) {
            sseLog(res, `Recherche Pappers pour "${company}"...`, 'search');
            pappersInfo = await pappersSearch(company);
            if (pappersInfo) {
                sseLog(res, `Pappers : <strong>${pappersInfo.nom}</strong> (SIREN: ${pappersInfo.siren})`, 'success');
                if (pappersInfo._ambiguous) sseLog(res, `Ambiguïté Pappers : ${pappersInfo._alternatives.join(', ')}`, 'warn');
                if (pappersInfo.dirigeants.length > 0) {
                    const dirList = pappersInfo.dirigeants.slice(0, 3).map(d => `${d.prenom} ${d.nom} (${d.fonction})`).join(', ');
                    sseLog(res, `Dirigeants : ${dirList}`, 'info');
                }
                if (pappersInfo.telephone) {
                    addCandidate(candidates, pappersInfo.telephone, 'phone', 'Pappers.fr', { proximity: false, isCompanyPhone: true });
                }
                if (pappersInfo.domaine && !allDomains.has(pappersInfo.domaine)) {
                    allDomains.set(pappersInfo.domaine, { mx: null, catchAll: null, source: 'Pappers' });
                    if (!domain.includes('.')) domain = pappersInfo.domaine;
                }
                for (const site of pappersInfo.sitesWeb || []) {
                    const d = site.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
                    if (d && !allDomains.has(d)) allDomains.set(d, { mx: null, catchAll: null, source: 'Pappers' });
                }
                res.write(`data: ${JSON.stringify({ event: 'pappers', data: pappersInfo })}\n\n`);
            } else {
                sseLog(res, 'Pappers : aucun résultat', 'warn');
            }
        }
        // UK Companies House (si company ressemble à une entité UK)
        if (KEYS.companieshouse && !pappersInfo && !company.includes('.')) {
            try {
                const ch = await companiesHouseSearch(company);
                if (ch) {
                    sseLog(res, `Companies House : <strong>${ch.name}</strong> (${ch.number})`, 'success');
                    if (ch.officers?.length > 0) {
                        sseLog(res, `Officers : ${ch.officers.slice(0, 3).map(o => o.name).join(', ')}`, 'info');
                    }
                }
            } catch (e) { log(`Companies House error: ${e.message}`); }
        }

        // ========================================
        // STEP 1: RESOLVE DOMAIN
        // ========================================
        sseProgress(res, 1, TOTAL_STEPS, 'Résolution du domaine...');
        if (!domain.includes('.')) domain = await resolveDomain(company, domain, res);
        if (!allDomains.has(domain)) allDomains.set(domain, { mx: null, catchAll: null, source: 'principal' });
        sseLog(res, `Domaine principal : <strong>${domain}</strong>`, 'info');

        // ========================================
        // STEP 1b: RDAP (registrant email)
        // ========================================
        try {
            const rdap = await rdapLookup(domain);
            if (rdap && rdap.emails.length > 0) {
                for (const e of rdap.emails) {
                    if (!GENERIC_LOCAL_PARTS.has(e.email.split('@')[0])) {
                        addCandidate(candidates, e.email, 'email', `RDAP/WHOIS (${e.role})`, { isDomainMatch: e.email.endsWith('@' + domain), proximity: false });
                        sseLog(res, `RDAP : <strong>${e.email}</strong> (${e.role})`, 'success');
                    }
                }
            }
        } catch (e) { log(`RDAP error: ${e.message}`); }

        // ========================================
        // STEP 2: MX CHECK + fingerprint primary
        // ========================================
        sseProgress(res, 2, TOTAL_STEPS, 'Vérification MX...');
        const mx = await checkMX(domain);
        allDomains.get(domain).mx = mx;
        if (mx.valid === true) {
            const fp = fingerprintMX(mx.records);
            allDomains.get(domain).mxProvider = fp.provider;
            allDomains.get(domain).catchAllPrior = fp.catchAllLikely;
            sseLog(res, `MX ${domain} : ${mx.records.slice(0, 2).join(', ')} → <strong>${fp.provider}</strong>`, 'success');
        } else if (mx.valid === false) sseLog(res, `Aucun MX pour ${domain}`, 'warn');

        // ========================================
        // STEPS 3-7: PARALLEL DISCOVERY (3 agents)
        // ========================================
        sseProgress(res, 3, TOTAL_STEPS, 'Discovery parallèle (APIs + Web + GitHub)...');
        sseLog(res, '<strong>[Agents] api-finder + web-scanner + github-scanner en parallèle</strong>', 'info');

        let apolloResult = null;
        const jinaResults = [];
        const parallelStart = Date.now();

        // --- AGENT A: API Discovery ---
        async function agentApiFinder() {
            sseLog(res, '[api-finder] Hunter + Snov + Apollo...', 'search');
            const apiPromises = [];
            if (KEYS.hunter && !exhaustedApis.has('hunter')) {
                apiPromises.push(hunterFinder(domain, name, exhaustedApis).then(r => ({ type: 'hunterFinder', data: r })).catch(e => ({ type: 'hunterFinder', error: e })));
                apiPromises.push(hunterDomain(domain, exhaustedApis).then(r => ({ type: 'hunterDomain', data: r })).catch(e => ({ type: 'hunterDomain', error: e })));
            }
            if (KEYS.snovId && KEYS.snovSecret && !exhaustedApis.has('snov')) {
                apiPromises.push(snovFindEmail(domain, name, exhaustedApis).then(r => ({ type: 'snov', data: r })).catch(e => ({ type: 'snov', error: e })));
            }
            if (KEYS.apollo && !exhaustedApis.has('apollo')) {
                apiPromises.push(apolloFindPerson(domain, name, company, exhaustedApis).then(r => ({ type: 'apollo', data: r })).catch(e => ({ type: 'apollo', error: e })));
            }

            const apiResults = await Promise.allSettled(apiPromises);
            for (const result of apiResults) {
                if (result.status === 'rejected') continue;
                const r = result.value;
                if (r.type === 'hunterFinder' && r.data) {
                    if (r.data._quotaExceeded) { sseLog(res, 'Hunter : quota épuisé', 'warn'); }
                    else if (r.data.email) {
                        sseLog(res, `Hunter Finder : <strong>${r.data.email}</strong> (score: ${r.data.score})`, 'success');
                        addCandidate(candidates, r.data.email, 'email', 'Hunter Finder', { isDomainMatch: r.data.email.endsWith('@' + domain), proximity: true });
                    }
                }
                if (r.type === 'hunterDomain' && r.data) {
                    if (r.data._quotaExceeded) sseLog(res, 'Hunter Domain : quota épuisé', 'warn');
                    hunterPattern = r.data.pattern;
                    hunterPatternSource = r.data.patternSource;
                    if (r.data.pattern) sseLog(res, `Hunter pattern : <strong>${r.data.pattern}</strong> (${hunterPatternSource})`, 'info');
                    let matchCount = 0;
                    for (const e of r.data.emails) {
                        const emailLocal = e.email.split('@')[0].toLowerCase();
                        const hunterName = normalize(e.name || '');
                        const firstClean = name.first.toLowerCase();
                        const lastClean = name.last.toLowerCase();
                        const isRelevant = emailLocal.includes(firstClean) || emailLocal.includes(lastClean) ||
                            (lastClean.length > 2 && hunterName.includes(lastClean)) || (firstClean.length > 2 && hunterName.includes(firstClean));
                        if (isRelevant) { addCandidate(candidates, e.email, 'email', 'Hunter Domain (match nom)', { isDomainMatch: true, proximity: true }); matchCount++; }
                        else { addCandidate(candidates, e.email, 'email', 'Hunter Domain (autre)', { isDomainMatch: true, proximity: false, isOtherEmployee: true }); }
                    }
                    sseLog(res, `Hunter Domain : ${r.data.emails.length} emails (${matchCount} pertinent(s))`, 'success');
                }
                if (r.type === 'snov' && r.data && r.data.length > 0) {
                    if (r.data[0]?._quotaExceeded) sseLog(res, 'Snov.io : quota épuisé', 'warn');
                    else {
                        for (const e of r.data) addCandidate(candidates, e.email, 'email', 'Snov.io', { isDomainMatch: e.email.endsWith('@' + domain), proximity: true });
                        sseLog(res, `Snov.io : ${r.data.length} emails`, 'success');
                    }
                }
                if (r.type === 'apollo' && r.data) {
                    if (r.data._quotaExceeded) { sseLog(res, 'Apollo : quota épuisé', 'warn'); continue; }
                    apolloResult = r.data;
                    apolloTitle = r.data.title || null;
                    if (r.data.email) {
                        addCandidate(candidates, r.data.email, 'email', 'Apollo.io', { isDomainMatch: r.data.email.endsWith('@' + domain), proximity: true, apolloTitle: r.data.title, apolloLinkedin: r.data.linkedin });
                        sseLog(res, `Apollo : <strong>${r.data.email}</strong>${r.data.title ? ' (' + r.data.title + ')' : ''}`, 'success');
                    }
                    if (r.data.phones?.length > 0) {
                        for (const phone of r.data.phones) addCandidate(candidates, phone, 'phone', 'Apollo.io', { proximity: true });
                    }
                    if (r.data.linkedin) addCandidate(candidates, r.data.linkedin, 'linkedin', 'Apollo.io', { proximity: true });
                }
            }

            if (apolloResult?.orgDomain && !allDomains.has(apolloResult.orgDomain)) {
                allDomains.set(apolloResult.orgDomain, { mx: null, catchAll: null, source: 'Apollo org' });
            }
            for (const c of candidates) {
                if (c.type === 'email') {
                    const d = c.value.split('@')[1];
                    if (d && !allDomains.has(d)) allDomains.set(d, { mx: null, catchAll: null, source: c.sources[0] });
                }
            }
            sseLog(res, `[api-finder] terminé (${((Date.now() - parallelStart) / 1000).toFixed(1)}s)`, 'success');
        }

        // --- AGENT B: Web Scanner (Jina / Serper / Tavily / Bing) + Wayback ---
        async function agentWebScanner() {
            sseLog(res, '[web-scanner] Recherches web multi-moteurs...', 'search');
            const searchQueries = [
                { label: 'Contact direct', query: `"${fullname}" "${company}" email contact` },
                { label: 'Coordonnées', query: `"${fullname}" "${company}" mail téléphone` },
                { label: 'Profil LinkedIn', query: `"${fullname}" "${company}" linkedin profil` },
                { label: 'Annuaires', query: `"${fullname}" "${company}" societe.com OR pappers OR verif` },
                { label: 'Téléphone', query: `"${fullname}" "${company}" telephone OR phone OR "+33"` },
                { label: 'Actualités', query: `"${fullname}" "${company}" interview OR nomination OR article` },
                { label: 'Biographie', query: `"${fullname}" parcours OR biographie OR CV` },
            ];

            let successes = 0, failures = 0, stopped = false;
            const BATCH = 3;
            for (let bs = 0; bs < searchQueries.length && !stopped; bs += BATCH) {
                const batch = searchQueries.slice(bs, bs + BATCH);
                const proms = batch.map(async (sq, idx) => {
                    if (stopped) return;
                    sseLog(res, `Recherche ${bs + idx + 1}/${searchQueries.length} : <strong>${sq.label}</strong>`, 'search');
                    try {
                        const { results, engine } = await multiSearch(sq.query, { num: 5 });
                        successes++;
                        for (const r of results) {
                            jinaResults.push(r);
                            sources.push({ title: r.title || '', url: r.url || '', query: sq.label, engine });
                            const content = [r.content, r.description, r.title].filter(Boolean).join(' ');
                            if (content) {
                                const extracted = extractContactsContextual(content, r.url || sq.label, fullname, domain);
                                for (const ex of extracted) addCandidate(candidates, ex.value, ex.type, ex.source, { proximity: ex.proximity, proximityScore: ex.proximityScore, isDomainMatch: ex.isDomainMatch, isGeneric: ex.isGeneric });
                            }
                        }
                        sseLog(res, `→ ${results.length} résultats (${engine})`, results.length > 0 ? 'success' : 'warn');
                    } catch (err) {
                        if (err.message?.includes('Timeout')) { failures++; sseLog(res, `Timeout "${sq.label}"`, 'warn'); }
                        else { failures++; sseLog(res, `Erreur "${sq.label}": ${err.message}`, 'error'); }
                    }
                });
                await Promise.allSettled(proms);
                if (failures >= 3 && successes === 0) { sseLog(res, 'Moteurs down — arrêt web search', 'warn'); stopped = true; break; }
                if (bs + BATCH < searchQueries.length && !stopped) await sleep(300);
            }

            // Lecture pages contact / team / about (priorisé)
            const urlsToRead = new Set();
            for (const d of allDomains.keys()) {
                if (allDomains.get(d).mx?.valid) {
                    urlsToRead.add(`https://${d}/contact`);
                    urlsToRead.add(`https://www.${d}/contact`);
                    urlsToRead.add(`https://${d}/about`);
                    urlsToRead.add(`https://${d}/team`);
                    urlsToRead.add(`https://${d}/equipe`);
                }
            }
            const pageKw = ['contact', 'team', 'equipe', 'about', 'annuaire', 'profil'];
            for (const r of jinaResults) {
                if (!r.url || !shouldReadUrl(r.url)) continue;
                const ul = r.url.toLowerCase(); const tl = (r.title || '').toLowerCase();
                if (pageKw.some(k => ul.includes(k) || tl.includes(k))) urlsToRead.add(r.url);
                if (urlsToRead.size >= 10) break;
            }
            const filteredUrls = [...urlsToRead].filter(shouldReadUrl).slice(0, 10);

            if (KEYS.jina) {
                for (let bs = 0; bs < filteredUrls.length; bs += BATCH) {
                    const batch = filteredUrls.slice(bs, bs + BATCH);
                    await Promise.allSettled(batch.map(async (url) => {
                        sseLog(res, `Lecture : ${url.replace('https://', '').substring(0, 60)}`, 'search');
                        try {
                            const pageData = await jinaRead(url);
                            if (pageData.content) {
                                const extracted = extractContactsContextual(pageData.content, url, fullname, domain);
                                for (const ex of extracted) addCandidate(candidates, ex.value, ex.type, ex.source, { proximity: ex.proximity, proximityScore: ex.proximityScore, isDomainMatch: ex.isDomainMatch, isGeneric: ex.isGeneric });
                                sources.push({ title: pageData.title || url, url, query: 'Lecture directe' });
                            }
                        } catch (e) { sseLog(res, `→ inaccessible (${(e.message || '').substring(0, 50)})`, 'warn'); }
                    }));
                    if (bs + BATCH < filteredUrls.length) await sleep(150);
                }
            }

            // Wayback : pages archivées du domaine (si > 0 emails trouvés via web, on skip ; sinon c'est un bon fallback)
            if (candidates.filter(c => c.type === 'email').length < 2) {
                sseLog(res, 'Wayback Machine : recherche pages contact archivées...', 'search');
                try {
                    const pages = await waybackContactPages(domain, 3);
                    for (const pg of pages) {
                        const extracted = extractContactsContextual(pg.text, pg.url, fullname, domain);
                        for (const ex of extracted) addCandidate(candidates, ex.value, ex.type, `Wayback ${pg.timestamp}`, { proximity: ex.proximity, proximityScore: ex.proximityScore, isDomainMatch: ex.isDomainMatch, isGeneric: ex.isGeneric });
                        sources.push({ title: `Archive ${pg.timestamp}`, url: pg.url, query: 'Wayback' });
                    }
                    if (pages.length > 0) sseLog(res, `Wayback : ${pages.length} page(s) archivée(s) lue(s)`, 'success');
                } catch (e) { log(`Wayback error: ${e.message}`); }
            }
            sseLog(res, `[web-scanner] terminé (${((Date.now() - parallelStart) / 1000).toFixed(1)}s)`, 'success');
        }

        // --- AGENT C: GitHub ---
        async function agentGithub() {
            sseLog(res, '[github] Recherche commits + profils...', 'search');
            try {
                // 1. Search users by name
                const gh = await githubFindUser(name, company, exhaustedApis);
                if (gh?._quotaExceeded) { sseLog(res, 'GitHub : quota épuisé', 'warn'); return; }
                if (gh?.users?.length > 0) {
                    for (const u of gh.users) {
                        addCandidate(candidates, u.email, 'email', `GitHub (${u.source || 'profile'})`, {
                            isDomainMatch: u.email.endsWith('@' + domain),
                            proximity: true,
                            githubLogin: u.login,
                        });
                        sseLog(res, `GitHub : <strong>${u.email}</strong> (${u.login})`, 'success');
                    }
                }

                // 2. Search commits by domain (coup de chance : un dev a committé avec son email pro)
                const commits = await githubSearchCommitsByDomain(domain, exhaustedApis);
                const firstLower = name.first.toLowerCase();
                const lastLower = name.last.toLowerCase();
                for (const c of commits) {
                    const author = (c.name || '').toLowerCase();
                    if (author.includes(firstLower) || author.includes(lastLower)) {
                        addCandidate(candidates, c.email, 'email', 'GitHub commits', {
                            isDomainMatch: true, proximity: true,
                        });
                        sseLog(res, `GitHub commit match : <strong>${c.email}</strong>`, 'success');
                    }
                }
            } catch (e) { log(`GitHub agent error: ${e.message}`); }
            sseLog(res, `[github] terminé (${((Date.now() - parallelStart) / 1000).toFixed(1)}s)`, 'success');
        }

        // Lancer les 3 agents en parallèle
        await Promise.all([agentApiFinder(), agentWebScanner(), agentGithub()]);
        const parallelElapsed = ((Date.now() - parallelStart) / 1000).toFixed(1);
        sseLog(res, `<strong>Discovery terminée en ${parallelElapsed}s (parallèle)</strong>`, 'success');

        // ========================================
        // STEP 5: MX + catch-all sur TOUS les domaines (parallèle)
        // ========================================
        sseProgress(res, 5, TOTAL_STEPS, 'MX + détection catch-all (parallèle)...');
        const domainsNeedingMx = [...allDomains.entries()].filter(([, info]) => !info.mx).map(([d]) => d);
        if (domainsNeedingMx.length > 0) {
            const mxResults = await checkMXBatch(domainsNeedingMx);
            for (const { domain: d, mx } of mxResults) {
                allDomains.get(d).mx = mx;
                if (mx.valid) {
                    const fp = fingerprintMX(mx.records);
                    allDomains.get(d).mxProvider = fp.provider;
                    allDomains.get(d).catchAllPrior = fp.catchAllLikely;
                }
                sseLog(res, `MX ${d} : ${mx.valid ? 'OK' : 'KO'}${allDomains.get(d).mxProvider ? ' (' + allDomains.get(d).mxProvider + ')' : ''}`, mx.valid ? 'success' : 'warn');
            }
        }
        // Catch-all sur domaines valides
        for (const [d, info] of allDomains) {
            if (info.mx?.valid && info.catchAll === null) {
                info.catchAll = await detectCatchAll(d, exhaustedApis);
                if (info.catchAll === true) sseLog(res, `${d} est catch-all — SMTP peu fiable`, 'warn');
                else if (info.catchAll === false) sseLog(res, `${d} : SMTP fiable`, 'success');
            }
        }

        // Marque confirmed dirigeant Pappers
        if (pappersInfo?.dirigeants) {
            const nameNorm = normalize(fullname);
            const isDirector = pappersInfo.dirigeants.some(d => {
                const dName = normalize(`${d.prenom} ${d.nom}`);
                return dName.includes(nameNorm) || nameNorm.includes(dName);
            });
            if (isDirector) {
                sseLog(res, `${fullname} confirmé dirigeant par Pappers`, 'success');
                for (const c of candidates) c.pappersConfirmed = true;
            }
        }

        // ========================================
        // STEP 6b: SECURITYTRAILS subdomains
        // ========================================
        if (KEYS.securitytrails) {
            sseProgress(res, 6, TOTAL_STEPS, 'Énumération sous-domaines...');
            try {
                const subs = await securitytrailsSubdomains(domain, exhaustedApis);
                const filtered = subs.filter(s => /^(contact|team|mail|about|staff|corp|www)/i.test(s)).slice(0, 5);
                if (filtered.length > 0) {
                    const subResults = await checkMXBatch(filtered);
                    for (const { domain: d, mx } of subResults) {
                        if (mx.valid && !allDomains.has(d)) {
                            allDomains.set(d, { mx, catchAll: null, source: 'SecurityTrails' });
                            sseLog(res, `Sous-domaine : <strong>${d}</strong>`, 'success');
                        }
                    }
                }
            } catch (e) { log(`SecurityTrails error: ${e.message}`); }
        }

        // ========================================
        // STEP 7b: Découverte domaines secondaires via URLs / régional
        // ========================================
        const domainsBefore = allDomains.size;
        const urlHints = extractDomainHintsFromUrls(jinaResults, company, domain);
        const regionalHints = guessRegionalDomains(company, domain);
        const allHints = [...new Set([...urlHints, ...regionalHints])].filter(h => !allDomains.has(h));

        if (allHints.length > 0) {
            const hintResults = await checkMXBatch(allHints);
            for (const { domain: d, mx } of hintResults) {
                if (mx.valid) {
                    const fp = fingerprintMX(mx.records);
                    allDomains.set(d, { mx, catchAll: null, source: 'découverte', mxProvider: fp.provider, catchAllPrior: fp.catchAllLikely });
                    sseLog(res, `Domaine secondaire : <strong>${d}</strong>`, 'success');
                }
            }
        }
        if (allDomains.size - domainsBefore > 0) {
            sseLog(res, `${allDomains.size - domainsBefore} nouveau(x) domaine(s)`, 'info');
        }
        // Catch-all sur nouveaux domaines
        for (const [d, info] of allDomains) {
            if (info.mx?.valid && info.catchAll === null) {
                info.catchAll = await detectCatchAll(d, exhaustedApis);
            }
        }

        // ========================================
        // STEP 8: PREDICTIONS (avec title + stats repriorization)
        // ========================================
        sseProgress(res, 8, TOTAL_STEPS, 'Prédictions email (stats-aware)...');
        const allPredictions = [];
        for (const [d, info] of allDomains) {
            if (info.mx?.valid) {
                let preds = generateEmailPatterns(name, d, { title: apolloTitle });
                preds = reprioritizeByStats(preds, d, company);
                for (const p of preds) {
                    if (!findCandidate(candidates, p.email, 'email')) allPredictions.push(p);
                }
            }
        }
        const industry = detectIndustry(company);
        sseLog(res, `${allPredictions.length} prédictions (industrie: ${industry || 'générique'})`, 'success');

        // ========================================
        // STEP 9: VERIFICATION BATCH (Gravatar + Hunter + Abstract + EmailRep + SMTP direct)
        // ========================================
        sseProgress(res, 9, TOTAL_STEPS, 'Vérification emails (multi-layer)...');

        const emailCandidates = candidates.filter(c => c.type === 'email' && !c.eliminated);
        const sortedForVerify = emailCandidates
            .sort((a, b) => {
                const sa = (a.proximity ? 10 : 0) + (a.isDomainMatch ? 5 : 0) + a.sources.length * 3;
                const sb = (b.proximity ? 10 : 0) + (b.isDomainMatch ? 5 : 0) + b.sources.length * 3;
                return sb - sa;
            }).slice(0, 15);

        const predsToVerify = allPredictions.slice(0, 8); // priorité élevée d'abord
        const allToCheck = [...sortedForVerify.map(c => c.value), ...predsToVerify.map(p => p.email)];
        const uniqueEmails = [...new Set(allToCheck.map(e => e.toLowerCase()))];

        // 9a. Gravatar (gratuit, parallèle)
        sseLog(res, `Gravatar : ${uniqueEmails.length} emails...`, 'verify');
        const gravResults = await Promise.all(uniqueEmails.map(e => checkGravatar(e).then(exists => ({ email: e, exists }))));
        let gravHits = 0;
        for (const gr of gravResults) {
            if (gr.exists) {
                gravHits++;
                const cand = findCandidate(candidates, gr.email, 'email');
                if (cand) cand.gravatarExists = true;
                const pred = predsToVerify.find(p => p.email.toLowerCase() === gr.email);
                if (pred && !findCandidate(candidates, gr.email, 'email')) {
                    const nc = addCandidate(candidates, gr.email, 'email', 'Prédiction + Gravatar', { isDomainMatch: true });
                    nc.gravatarExists = true;
                }
            }
        }
        sseLog(res, `Gravatar : ${gravHits}/${uniqueEmails.length}`, gravHits > 0 ? 'success' : 'info');

        // 9b. SMTP verification (Hunter > Abstract > SMTP direct)
        const emailsToVerify = candidates
            .filter(c => c.type === 'email' && !c.eliminated && !c.isOtherEmployee)
            .filter(c => {
                const localPart = c.value.split('@')[0].toLowerCase().replace(/-/g, '');
                return !GENERIC_LOCAL_PARTS.has(localPart);
            })
            .sort((a, b) => {
                const aStrong = a.sources.some(s => /Apollo|Hunter Finder|Snov|GitHub|RDAP/.test(s)) ? 100 : 0;
                const bStrong = b.sources.some(s => /Apollo|Hunter Finder|Snov|GitHub|RDAP/.test(s)) ? 100 : 0;
                const aPred = a.sources.some(s => /Prédiction|Prediction/.test(s)) ? 30 : 0;
                const bPred = b.sources.some(s => /Prédiction|Prediction/.test(s)) ? 30 : 0;
                return (bStrong + bPred + (b.proximity ? 20 : 0)) - (aStrong + aPred + (a.proximity ? 20 : 0));
            }).slice(0, 10);

        const predictionsToVerify = [];
        for (const pred of allPredictions) {
            if (predictionsToVerify.length >= 5) break;
            const predDomain = pred.email.split('@')[1];
            const domainInfo = allDomains.get(predDomain);
            if (domainInfo?.catchAll !== true && domainInfo?.mx?.valid && !findCandidate(candidates, pred.email, 'email')) {
                predictionsToVerify.push(pred);
            }
        }

        let hunterVerifyCount = 0, abstractVerifyCount = 0, smtpDirectCount = 0, emailRepCount = 0;
        const HUNTER_LIMIT = 10, ABSTRACT_LIMIT = 10, SMTP_LIMIT = 8, EMAILREP_LIMIT = 15;

        // Hunter
        if (KEYS.hunter && !exhaustedApis.has('hunter_verify')) {
            for (const cand of emailsToVerify) {
                if (hunterVerifyCount >= HUNTER_LIMIT || exhaustedApis.has('hunter_verify')) break;
                if (cand.hunterVerified) continue;
                const emailDomain = cand.value.split('@')[1];
                const domainInfo = allDomains.get(emailDomain);
                if (domainInfo?.catchAll === true) continue;
                try {
                    const vr = await hunterVerify(cand.value, exhaustedApis);
                    if (vr?._quotaExceeded) break;
                    hunterVerifyCount++;
                    if (vr) {
                        cand.hunterVerified = vr;
                        sseLog(res, `Hunter ${cand.value} : ${vr.status}`, vr.status === 'valid' ? 'success' : vr.status === 'invalid' ? 'error' : 'info');
                    }
                } catch (e) { /* */ }
                await sleep(150);
            }
            // Verify predictions
            for (const pred of predictionsToVerify) {
                if (hunterVerifyCount >= HUNTER_LIMIT + 5 || exhaustedApis.has('hunter_verify')) break;
                if (findCandidate(candidates, pred.email, 'email')) continue;
                try {
                    const vr = await hunterVerify(pred.email, exhaustedApis);
                    if (vr?._quotaExceeded) break;
                    hunterVerifyCount++;
                    if (vr && (vr.status === 'valid' || vr.result === 'deliverable')) {
                        sseLog(res, `Prédiction vérifiée : <strong>${pred.email}</strong>`, 'success');
                        const nc = addCandidate(candidates, pred.email, 'email', 'Prédiction vérifiée', { isDomainMatch: true });
                        nc.hunterVerified = vr;
                    }
                } catch (e) { /* */ }
                await sleep(150);
            }
        }

        // Abstract (fallback si Hunter épuisé ou pas dispo)
        const useAbstract = KEYS.abstract && (!KEYS.hunter || exhaustedApis.has('hunter_verify'));
        if (useAbstract && !exhaustedApis.has('abstract')) {
            for (const cand of emailsToVerify) {
                if (abstractVerifyCount >= ABSTRACT_LIMIT || exhaustedApis.has('abstract')) break;
                if (cand.abstractVerified) continue;
                const emailDomain = cand.value.split('@')[1];
                const domainInfo = allDomains.get(emailDomain);
                if (domainInfo?.catchAll === true) continue;
                try {
                    const av = await abstractVerify(cand.value, exhaustedApis);
                    if (av?._quotaExceeded) break;
                    abstractVerifyCount++;
                    if (av) cand.abstractVerified = av;
                } catch (e) { /* */ }
                await sleep(150);
            }
        }

        // SMTP direct (fallback si Hunter ET Abstract épuisés/absents)
        const useSmtpDirect = (!KEYS.hunter || exhaustedApis.has('hunter_verify'))
                           && (!KEYS.abstract || exhaustedApis.has('abstract'));
        if (useSmtpDirect) {
            sseLog(res, 'SMTP direct (fallback gratuit)...', 'verify');
            for (const cand of emailsToVerify) {
                if (smtpDirectCount >= SMTP_LIMIT) break;
                if (cand.smtpDirect) continue;
                const emailDomain = cand.value.split('@')[1];
                const domainInfo = allDomains.get(emailDomain);
                if (domainInfo?.catchAll === true) continue;
                try {
                    const sr = await smtpVerifyEmail(cand.value);
                    smtpDirectCount++;
                    cand.smtpDirect = sr;
                    sseLog(res, `SMTP ${cand.value} : ${sr.valid === true ? 'OK' : sr.valid === false ? 'KO' : '??'} (${sr.reason})`,
                        sr.valid ? 'success' : sr.valid === false ? 'error' : 'info');
                } catch (e) { /* */ }
            }
        }

        // EmailRep : réputation + confirmation croisée (100/j gratuit sans clé)
        sseLog(res, 'EmailRep (réputation + réf. publiques)...', 'verify');
        const topForRep = emailsToVerify.slice(0, EMAILREP_LIMIT);
        await Promise.allSettled(topForRep.map(async cand => {
            if (cand.emailRep) return;
            try {
                const er = await emailRepCheck(cand.value, exhaustedApis);
                if (er?._quotaExceeded) { sseLog(res, 'EmailRep : quota épuisé', 'warn'); return; }
                if (er) { cand.emailRep = er; emailRepCount++; }
            } catch (e) { /* */ }
        }));

        // ========================================
        // STEP 10: REVERSE CROSS-CHECK (W3.3)
        // Pour les top candidats non-vérifiés : cherche l'email littéral sur le web.
        // Si le contenu mentionne aussi le nom → très fort signal.
        // ========================================
        sseProgress(res, 10, TOTAL_STEPS, 'Reverse cross-check des top candidats...');
        const toReverseCheck = candidates
            .filter(c => c.type === 'email' && !c.eliminated && !c.isOtherEmployee)
            .filter(c => !c.sources.some(s => /Apollo|Hunter Finder|Snov/.test(s))) // skip si déjà forte source API
            .slice(0, 3);
        for (const cand of toReverseCheck) {
            try {
                const { results } = await multiSearch(`"${cand.value}"`, { num: 3 });
                const nameNorm = normalize(fullname);
                for (const r of results) {
                    const content = [r.title, r.content, r.description].filter(Boolean).join(' ');
                    if (normalize(content).includes(nameNorm)) {
                        cand.reverseConfirmed = true;
                        sseLog(res, `Reverse : <strong>${cand.value}</strong> mentionné avec le nom sur ${r.url?.substring(0, 50)}`, 'success');
                        break;
                    }
                }
            } catch (e) { /* */ }
        }

        // ========================================
        // DNC FILTER
        // ========================================
        for (const c of candidates) {
            const hit = isDnc(c.value);
            if (hit) {
                c.eliminated = true;
                c.eliminatedReason = `DNC (${hit.reason || 'do-not-contact'})`;
            }
        }

        // ========================================
        // STEP 11: SCORING
        // ========================================
        sseProgress(res, 11, TOTAL_STEPS, 'Scoring multi-critères...');
        computeScores(candidates, allDomains, hunterPattern, name, pappersInfo);

        for (const c of candidates) {
            if (c.eliminated) continue;
            if (c.type === 'email' && c.isGeneric && !c.proximity && c.score < 10) {
                c.eliminated = true; c.eliminatedReason = 'Email générique sans lien';
                continue;
            }
            const hasStrongSource = c.sources.some(s =>
                /Apollo|Hunter Finder|Snov|GitHub|RDAP|Prédiction vérifiée/.test(s)
            );
            if (hasStrongSource) continue;
            if (c.score < 10 && c.score > 0) {
                c.eliminated = true; c.eliminatedReason = 'Score trop bas sans source fiable';
            }
        }

        // ========================================
        // STEP 12: RESULTS
        // ========================================
        sseProgress(res, 12, TOTAL_STEPS, 'Finalisation...');
        const elapsed = ((Date.now() - scanStart) / 1000).toFixed(1);
        const mainActive = candidates.filter(c => !c.eliminated && !c.isOtherEmployee);
        const otherEmployees = candidates.filter(c => !c.eliminated && c.isOtherEmployee && c.score > 0).sort((a, b) => b.score - a.score);
        const eliminated = candidates.filter(c => c.eliminated);

        const verified = mainActive.filter(c => c.score >= 90).sort((a, b) => b.score - a.score);
        const probable = mainActive.filter(c => c.score >= 60 && c.score < 90).sort((a, b) => b.score - a.score);
        const possible = mainActive.filter(c => c.score >= 30 && c.score < 60).sort((a, b) => b.score - a.score);
        const low = mainActive.filter(c => c.score >= 10 && c.score < 30);

        sseLog(res, `Terminé en ${elapsed}s. ${verified.length} vérifiés, ${probable.length} probables, ${possible.length} possibles, ${eliminated.length + low.length} éliminés.`, 'success');
        sseLog(res, `Crédits : Hunter ${hunterVerifyCount}, Abstract ${abstractVerifyCount}, SMTP direct ${smtpDirectCount}, EmailRep ${emailRepCount}`, 'info');

        const clean = c => ({
            value: c.value, type: c.type, sources: c.sources, proofs: c.proofs, warnings: c.warnings || [], score: c.score,
            eliminated: c.eliminated, eliminatedReason: c.eliminatedReason,
            proximity: c.proximity, proximityScore: c.proximityScore, isDomainMatch: c.isDomainMatch, isGeneric: c.isGeneric,
            apolloTitle: c.apolloTitle, apolloLinkedin: c.apolloLinkedin,
            emailRep: c.emailRep, smtpDirect: c.smtpDirect, reverseConfirmed: c.reverseConfirmed,
            githubLogin: c.githubLogin,
        });

        const predsFiltered = allPredictions.filter(p => !findCandidate(candidates, p.email, 'email'));
        const seenUrls = new Set();
        const uniqueSources = sources.filter(s => { if (seenUrls.has(s.url)) return false; seenUrls.add(s.url); return true; });

        const domainsInfo = {};
        for (const [d, info] of allDomains) {
            domainsInfo[d] = {
                mxValid: info.mx?.valid || false,
                catchAll: info.catchAll,
                source: info.source,
                mxProvider: info.mxProvider,
                catchAllPrior: info.catchAllPrior,
            };
        }

        sseDone(res, {
            elapsed: parseFloat(elapsed), domain, domainsInfo, hunterPattern, hunterPatternSource, pappersInfo,
            apolloTitle, industry,
            verified: verified.map(clean), probable: probable.map(clean), possible: possible.map(clean),
            otherEmployees: otherEmployees.map(clean),
            eliminated: [...eliminated, ...low].map(clean),
            predictions: predsFiltered.slice(0, 20),
            sources: uniqueSources,
            dorks: generateDorks(fullname, company, domain),
            summary: {
                verified: verified.length, probable: probable.length, possible: possible.length,
                otherEmployees: otherEmployees.length, eliminated: eliminated.length + low.length,
                sources: uniqueSources.length,
            }
        });
    } catch (err) {
        sseLog(res, `Erreur fatale : ${err.message}`, 'error');
        log(`FATAL: ${err.stack}`);
        sseDone(res, { error: err.message, elapsed: ((Date.now() - scanStart) / 1000).toFixed(1) });
    }
}

module.exports = { scanRoute, statusRoute };
