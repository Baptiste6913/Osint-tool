// ================================================================
// PIPELINE — Routes /api/scan et /api/status (Steps 0-11)
// ================================================================
const { KEYS, TIMEOUTS, GENERIC_LOCAL_PARTS } = require('./config');
const { parseName, extractDomain, normalize, log, sleep, shouldReadUrl, fetchWithTimeout } = require('./helpers');
const { sseLog, sseProgress, sseDone } = require('./sse');
const { checkMX } = require('./providers/dns');
const { checkGravatar } = require('./providers/gravatar');
const { jinaSearch, jinaRead } = require('./providers/jina');
const { hunterFinder, hunterDomain, hunterVerify } = require('./providers/hunter');
const { snovFindEmail } = require('./providers/snov');
const { apolloFindPerson } = require('./providers/apollo');
const { pappersSearch } = require('./providers/pappers');
const { abstractVerify } = require('./providers/abstract');
const { detectCatchAll, resolveDomain, extractDomainHintsFromUrls, guessRegionalDomains } = require('./domain-resolver');
const { extractContactsContextual } = require('./extractors');
const { generateEmailPatterns } = require('./predictions');
const { addCandidate, findCandidate } = require('./candidates');
const { computeScores } = require('./scoring');
const { generateDorks } = require('./dorks');

// ================================================================
// GET /api/status
// ================================================================
async function statusRoute(req, res) {
    const status = {
        apis: {
            jina: { configured: !!KEYS.jina, quota: null },
            hunter: { configured: !!KEYS.hunter, quota: null },
            snov: { configured: !!(KEYS.snovId && KEYS.snovSecret), quota: null },
            apollo: { configured: !!KEYS.apollo, quota: null },
            pappers: { configured: !!KEYS.pappers, quota: null },
            abstract: { configured: !!KEYS.abstract, quota: null, note: KEYS.hunter ? 'fallback (Hunter prioritaire)' : null },
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
            if (data.jetons_restants !== undefined) {
                status.apis.pappers.quota = { remaining: data.jetons_restants };
            }
        } catch (e) { log(`Status Pappers error: ${e.message}`); }
    }

    res.json(status);
}

// ================================================================
// POST /api/scan — Pipeline Steps 0-11
// ================================================================
async function scanRoute(req, res) {
    const { fullname, company } = req.body;
    if (!fullname || !company) return res.status(400).json({ error: 'fullname et company requis' });
    if (!KEYS.jina) return res.status(400).json({ error: 'JINA_API_KEY non configuree' });

    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });

    const scanStart = Date.now();
    const name = parseName(fullname);
    let domain = extractDomain(company);
    const candidates = [];
    const allDomains = new Map();
    let hunterPattern = null;
    let pappersInfo = null;
    const sources = [];
    const exhaustedApis = new Set();
    const TOTAL_STEPS = 11;

    sseLog(res, `Recherche : "<strong>${name.firstOg} ${name.lastOg}</strong>" chez "<strong>${company}</strong>" -> predictions: ${name.first}.${name.last}@...`, 'info');

    try {
        // ========================================
        // STEP 0: PAPPERS
        // ========================================
        sseProgress(res, 0, TOTAL_STEPS, 'Resolution entreprise (Pappers)...');

        if (KEYS.pappers && !company.includes('.')) {
            sseLog(res, `Recherche Pappers pour "${company}"...`, 'search');
            pappersInfo = await pappersSearch(company);
            if (pappersInfo) {
                sseLog(res, `Pappers : <strong>${pappersInfo.nom}</strong> (SIREN: ${pappersInfo.siren})`, 'success');
                if (pappersInfo._ambiguous) {
                    sseLog(res, `Ambiguite Pappers : alternatives : ${pappersInfo._alternatives.join(', ')}`, 'warn');
                }
                if (pappersInfo.dirigeants.length > 0) {
                    const dirList = pappersInfo.dirigeants.slice(0, 3).map(d => `${d.prenom} ${d.nom} (${d.fonction})`).join(', ');
                    sseLog(res, `Dirigeants : ${dirList}`, 'info');
                }
                if (pappersInfo.telephone) {
                    addCandidate(candidates, pappersInfo.telephone, 'phone', 'Pappers.fr', { proximity: false, isCompanyPhone: true });
                    sseLog(res, `Telephone Pappers : ${pappersInfo.telephone}`, 'success');
                }
                if (pappersInfo.domaine && !allDomains.has(pappersInfo.domaine)) {
                    allDomains.set(pappersInfo.domaine, { mx: null, catchAll: null, source: 'Pappers' });
                    if (!domain.includes('.')) domain = pappersInfo.domaine;
                }
                for (const site of pappersInfo.sitesWeb || []) {
                    const d = site.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
                    if (d && !allDomains.has(d)) {
                        allDomains.set(d, { mx: null, catchAll: null, source: 'Pappers' });
                        if (!domain.includes('.')) { domain = d; pappersInfo.domaine = d; }
                    }
                }
                if (pappersInfo.domaine) sseLog(res, `Domaine Pappers : <strong>${pappersInfo.domaine}</strong>`, 'success');
                res.write(`data: ${JSON.stringify({ event: 'pappers', data: pappersInfo })}\n\n`);
            } else {
                sseLog(res, 'Pappers : aucun resultat', 'warn');
            }
        }

        // ========================================
        // STEP 1: RESOLVE DOMAIN
        // ========================================
        sseProgress(res, 1, TOTAL_STEPS, 'Resolution du domaine...');
        if (!domain.includes('.')) domain = await resolveDomain(company, domain, res);
        if (!allDomains.has(domain)) allDomains.set(domain, { mx: null, catchAll: null, source: 'principal' });
        sseLog(res, `Domaine principal : <strong>${domain}</strong>`, 'info');

        // ========================================
        // STEP 2: MX CHECK (primary)
        // ========================================
        sseProgress(res, 2, TOTAL_STEPS, 'Verification MX...');
        const mx = await checkMX(domain);
        allDomains.get(domain).mx = mx;
        if (mx.valid === true) sseLog(res, `MX ${domain} : ${mx.records.slice(0, 2).join(', ')}`, 'success');
        else if (mx.valid === false) sseLog(res, `Aucun MX pour ${domain}`, 'warn');
        else sseLog(res, 'MX non conclusif', 'warn');

        // ========================================
        // STEPS 3-7: PARALLEL DISCOVERY (Ruflo agents)
        // APIs (Steps 3+4) et Web (Steps 6+7) en PARALLELE
        // ========================================
        sseProgress(res, 3, TOTAL_STEPS, 'Discovery parallele (APIs + Web)...');
        sseLog(res, '<strong>[Ruflo] Agents api-finder + web-scanner en parallele</strong>', 'info');

        let apolloResult = null;
        const jinaResults = [];
        const parallelStart = Date.now();

        // --- AGENT A: API Discovery (Steps 3 + 4) ---
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
                    if (r.data._quotaExceeded) { sseLog(res, 'Hunter : quota epuise', 'warn'); }
                    else if (r.data.email) {
                        sseLog(res, `Hunter Finder : <strong>${r.data.email}</strong> (score: ${r.data.score})`, 'success');
                        addCandidate(candidates, r.data.email, 'email', 'Hunter Finder', { isDomainMatch: r.data.email.endsWith('@' + domain), proximity: true });
                    }
                } else if (r.type === 'hunterFinder' && r.error) {
                    sseLog(res, `Hunter Finder : ${r.error.message || 'erreur'}`, 'warn');
                }

                if (r.type === 'hunterDomain' && r.data) {
                    if (r.data._quotaExceeded) sseLog(res, 'Hunter Domain : quota epuise', 'warn');
                    hunterPattern = r.data.pattern;
                    if (r.data.pattern) sseLog(res, `Hunter pattern : <strong>${r.data.pattern}</strong>`, 'info');
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
                    if (r.data[0]?._quotaExceeded) { sseLog(res, 'Snov.io : quota epuise', 'warn'); }
                    else {
                        for (const e of r.data) addCandidate(candidates, e.email, 'email', 'Snov.io', { isDomainMatch: e.email.endsWith('@' + domain), proximity: true });
                        sseLog(res, `Snov.io : ${r.data.length} emails`, 'success');
                    }
                } else if (r.type === 'snov' && r.error) { sseLog(res, `Snov.io : ${r.error.message || 'erreur'}`, 'warn'); }

                if (r.type === 'apollo' && r.data) {
                    if (r.data._quotaExceeded) { sseLog(res, 'Apollo : quota epuise', 'warn'); continue; }
                    apolloResult = r.data;
                    if (r.data.email) {
                        addCandidate(candidates, r.data.email, 'email', 'Apollo.io', { isDomainMatch: r.data.email.endsWith('@' + domain), proximity: true, apolloTitle: r.data.title, apolloLinkedin: r.data.linkedin });
                        sseLog(res, `Apollo : <strong>${r.data.email}</strong>${r.data.title ? ' (' + r.data.title + ')' : ''}`, 'success');
                    }
                    if (r.data.phones && r.data.phones.length > 0) {
                        for (const phone of r.data.phones) { addCandidate(candidates, phone, 'phone', 'Apollo.io', { proximity: true }); sseLog(res, `Apollo tel : ${phone}`, 'success'); }
                    }
                    if (r.data.linkedin) { addCandidate(candidates, r.data.linkedin, 'linkedin', 'Apollo.io', { proximity: true }); sseLog(res, `Apollo LinkedIn : ${r.data.linkedin}`, 'success'); }
                } else if (r.type === 'apollo' && r.error) { sseLog(res, `Apollo : ${r.error.message || 'erreur'}`, 'warn'); }
            }

            // Step 4: collect domains from API results
            if (apolloResult?.orgDomain && !allDomains.has(apolloResult.orgDomain)) {
                allDomains.set(apolloResult.orgDomain, { mx: null, catchAll: null, source: 'Apollo org' });
            }
            for (const c of candidates) {
                if (c.type === 'email') {
                    const d = c.value.split('@')[1];
                    if (d && !allDomains.has(d)) allDomains.set(d, { mx: null, catchAll: null, source: c.sources[0] });
                }
            }

            sseLog(res, `[api-finder] termine (${((Date.now() - parallelStart) / 1000).toFixed(1)}s)`, 'success');
        }

        // --- AGENT B: Web Scanner (Steps 6 + 7) ---
        async function agentWebScanner() {
            sseLog(res, '[web-scanner] Recherches Jina...', 'search');
            const searchQueries = [
                { label: 'Contact direct', query: `"${fullname}" "${company}" email contact` },
                { label: 'Coordonnees', query: `"${fullname}" "${company}" mail telephone` },
                { label: 'Profil LinkedIn', query: `"${fullname}" "${company}" linkedin profil` },
                { label: 'Annuaires', query: `"${fullname}" "${company}" societe.com OR pappers OR verif` },
                { label: 'Telephone', query: `"${fullname}" "${company}" telephone OR phone OR "+33"` },
                { label: 'Actualites', query: `"${fullname}" "${company}" interview OR nomination OR article` },
                { label: 'Biographie', query: `"${fullname}" parcours OR biographie OR CV` },
            ];

            let jinaSuccesses = 0, jinaFailures = 0, jinaStopped = false;
            const BATCH = 3;

            for (let bs = 0; bs < searchQueries.length && !jinaStopped; bs += BATCH) {
                const batch = searchQueries.slice(bs, bs + BATCH);
                const proms = batch.map(async (sq, idx) => {
                    if (jinaStopped) return;
                    sseLog(res, `Recherche ${bs + idx + 1}/${searchQueries.length} : <strong>${sq.label}</strong>`, 'search');
                    try {
                        const results = await jinaSearch(sq.query, { num: 5 });
                        jinaSuccesses++;
                        for (const r of results) {
                            jinaResults.push(r);
                            sources.push({ title: r.title || '', url: r.url || '', query: sq.label });
                            const content = [r.content, r.description, r.title].filter(Boolean).join(' ');
                            if (content) {
                                const extracted = extractContactsContextual(content, r.url || sq.label, fullname, domain);
                                for (const ex of extracted) addCandidate(candidates, ex.value, ex.type, ex.source, { proximity: ex.proximity, isDomainMatch: ex.isDomainMatch, isGeneric: ex.isGeneric });
                            }
                        }
                        sseLog(res, `-> ${results.length} resultats`, results.length > 0 ? 'success' : 'warn');
                    } catch (err) {
                        if (err.message && err.message.includes('Timeout')) { jinaFailures++; sseLog(res, `Timeout "${sq.label}"`, 'warn'); }
                        else if (err.message && err.message.includes('422')) { sseLog(res, `"${sq.label}" : aucun resultat`, 'info'); }
                        else { jinaFailures++; sseLog(res, `Erreur "${sq.label}": ${err.message}`, 'error'); }
                    }
                });
                await Promise.allSettled(proms);
                if (jinaFailures >= 3 && jinaSuccesses === 0) { sseLog(res, 'Jina ne repond pas — arret', 'warn'); jinaStopped = true; break; }
                if (jinaFailures > jinaSuccesses * 2 && jinaFailures >= 4) { sseLog(res, 'Jina instable — arret', 'warn'); jinaStopped = true; break; }
                if (bs + BATCH < searchQueries.length && !jinaStopped) await sleep(300);
            }

            // Step 7: Jina reader
            const urlsToRead = new Set();
            for (const d of allDomains.keys()) {
                if (allDomains.get(d).mx?.valid) { urlsToRead.add(`https://${d}/contact`); urlsToRead.add(`https://www.${d}/contact`); urlsToRead.add(`https://${d}/about`); }
            }
            const pageKw = ['contact', 'team', 'equipe', 'about', 'annuaire', 'profil'];
            for (const r of jinaResults) {
                if (!r.url || !shouldReadUrl(r.url)) continue;
                const ul = r.url.toLowerCase(); const tl = (r.title || '').toLowerCase();
                if (pageKw.some(k => ul.includes(k) || tl.includes(k))) urlsToRead.add(r.url);
                if (urlsToRead.size >= 8) break;
            }
            const filteredUrls = [...urlsToRead].filter(shouldReadUrl).slice(0, 8);

            for (let bs = 0; bs < filteredUrls.length; bs += BATCH) {
                const batch = filteredUrls.slice(bs, bs + BATCH);
                await Promise.allSettled(batch.map(async (url) => {
                    sseLog(res, `Lecture : ${url.replace('https://', '').substring(0, 60)}`, 'search');
                    try {
                        const pageData = await jinaRead(url);
                        if (pageData.content) {
                            const extracted = extractContactsContextual(pageData.content, url, fullname, domain);
                            for (const ex of extracted) addCandidate(candidates, ex.value, ex.type, ex.source, { proximity: ex.proximity, isDomainMatch: ex.isDomainMatch, isGeneric: ex.isGeneric });
                            sources.push({ title: pageData.title || url, url, query: 'Lecture directe' });
                        }
                    } catch (e) { sseLog(res, `-> inaccessible (${(e.message || '').substring(0, 50)})`, 'warn'); }
                }));
                if (bs + BATCH < filteredUrls.length) await sleep(150);
            }

            // Fallback phone search
            const phoneCount = candidates.filter(c => c.type === 'phone' && !c.eliminated).length;
            if (phoneCount === 0) {
                try {
                    const phoneResults = await jinaSearch(`"${company}" telephone contact numero`, { num: 3 });
                    const companyFirst = company.toLowerCase().split(' ')[0];
                    for (const r of phoneResults) {
                        const content = [r.content, r.description].filter(Boolean).join(' ');
                        if (!content || !content.toLowerCase().includes(companyFirst)) continue;
                        const phoneRxs = [/(?:\+33|0033)[\s.\-]?[1-9](?:[\s.\-]?\d{2}){4}/g, /\b0[1-9](?:[\s.\-]?\d{2}){4}\b/g];
                        for (const rx of phoneRxs) {
                            let pm;
                            while ((pm = rx.exec(content)) !== null) {
                                const raw = pm[0].trim(); const digits = raw.replace(/\D/g, '');
                                if (digits.length >= 10 && digits.length <= 15) {
                                    let display = raw;
                                    if (/^0[1-9]\d{8}$/.test(digits)) display = digits.replace(/(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/, '$1 $2 $3 $4 $5');
                                    addCandidate(candidates, display, 'phone', r.url || 'Recherche telephone', { proximity: false, isCompanyPhone: true });
                                }
                            }
                        }
                    }
                } catch (e) { log(`Phone fallback error: ${e.message}`); }
            }

            sseLog(res, `[web-scanner] termine (${((Date.now() - parallelStart) / 1000).toFixed(1)}s)`, 'success');
        }

        // --- LANCEMENT PARALLELE des 2 agents ---
        await Promise.all([agentApiFinder(), agentWebScanner()]);
        const parallelElapsed = ((Date.now() - parallelStart) / 1000).toFixed(1);
        sseLog(res, `<strong>[Ruflo] Discovery terminee en ${parallelElapsed}s (parallele)</strong>`, 'success');

        sseProgress(res, 5, TOTAL_STEPS, 'MX + detection catch-all...');

        // Step 5: MX + catch-all on ALL domains (apres merge des 2 agents)
        for (const [d, info] of allDomains) {
            if (!info.mx) {
                info.mx = await checkMX(d);
                sseLog(res, `MX ${d} : ${info.mx.valid ? 'OK' : 'KO'}`, info.mx.valid ? 'success' : 'warn');
            }
            if (info.mx?.valid && info.catchAll === null) {
                info.catchAll = await detectCatchAll(d, exhaustedApis);
                if (info.catchAll === true) sseLog(res, `${d} est catch-all — SMTP non fiable`, 'warn');
                else if (info.catchAll === false) sseLog(res, `${d} : SMTP fiable`, 'success');
                else sseLog(res, `${d} : catch-all indetermine`, 'info');
            }
        }

        // Mark pappers confirmation on candidates
        if (pappersInfo?.dirigeants) {
            const nameNorm = normalize(fullname);
            const isDirector = pappersInfo.dirigeants.some(d => {
                const dName = normalize(`${d.prenom} ${d.nom}`);
                return dName.includes(nameNorm) || nameNorm.includes(dName);
            });
            if (isDirector) {
                sseLog(res, `${fullname} confirme dirigeant par Pappers`, 'success');
                for (const c of candidates) { c.pappersConfirmed = true; }
            }
        }

        // Generate predictions for secondary domains
        for (const [d, info] of allDomains) {
            if (info.mx?.valid && d !== domain) {
                const altPreds = generateEmailPatterns(name, d);
                for (const pred of altPreds.slice(0, 5)) {
                    if (!findCandidate(candidates, pred.email, 'email')) addCandidate(candidates, pred.email, 'email', `Prediction @${d}`, { isDomainMatch: true });
                }
            }
        }

        // ========================================
        // STEP 7b: DISCOVER + PROCESS SECONDARY DOMAINS
        // ========================================
        const domainsBefore = allDomains.size;

        for (const c of candidates) {
            if (c.type === 'email') {
                const d = c.value.split('@')[1];
                if (d && !allDomains.has(d)) {
                    allDomains.set(d, { mx: null, catchAll: null, source: c.sources[0] });
                }
            }
        }

        const urlHints = extractDomainHintsFromUrls(jinaResults, company, domain);
        const regionalHints = guessRegionalDomains(company, domain);

        const allHints = new Set([...urlHints, ...regionalHints]);
        for (const hint of allHints) {
            if (allDomains.has(hint)) continue;
            const hintMx = await checkMX(hint);
            if (hintMx.valid) {
                allDomains.set(hint, { mx: hintMx, catchAll: null, source: 'decouverte' });
                sseLog(res, `Domaine secondaire decouvert : <strong>${hint}</strong>`, 'success');
            }
        }

        const newDomainsFound = allDomains.size - domainsBefore;
        if (newDomainsFound > 0) {
            sseLog(res, `${newDomainsFound} nouveau(x) domaine(s) decouvert(s)`, 'info');
        }
        for (const [d, info] of allDomains) {
            if (!info.mx) {
                info.mx = await checkMX(d);
                sseLog(res, `MX ${d} : ${info.mx.valid ? 'OK' : 'KO'}`, info.mx.valid ? 'success' : 'warn');
            }
            if (info.mx?.valid && info.catchAll === null) {
                info.catchAll = await detectCatchAll(d, exhaustedApis);
                if (info.catchAll === true) sseLog(res, `${d} est catch-all`, 'warn');
                else if (info.catchAll === false) sseLog(res, `${d} : SMTP fiable`, 'success');
            }
        }
        sseLog(res, `${allDomains.size} domaine(s) total`, 'info');

        // ========================================
        // STEP 8: PREDICTIONS (ALL valid domains)
        // ========================================
        sseProgress(res, 8, TOTAL_STEPS, 'Predictions email...');
        const allPredictions = [];
        for (const [d, info] of allDomains) {
            if (info.mx?.valid) {
                const preds = generateEmailPatterns(name, d);
                for (const p of preds) {
                    if (!findCandidate(candidates, p.email, 'email')) allPredictions.push(p);
                }
            }
        }
        sseLog(res, `${allPredictions.length} predictions sur ${[...allDomains.entries()].filter(([, i]) => i.mx?.valid).length} domaine(s)`, 'success');

        // ========================================
        // STEP 9: VERIFICATION BATCH
        // ========================================
        sseProgress(res, 9, TOTAL_STEPS, 'Verification emails...');

        const emailCandidates = candidates.filter(c => c.type === 'email' && !c.eliminated);
        const sortedForVerify = emailCandidates
            .sort((a, b) => {
                const sa = (a.proximity ? 10 : 0) + (a.isDomainMatch ? 5 : 0) + a.sources.length * 3;
                const sb = (b.proximity ? 10 : 0) + (b.isDomainMatch ? 5 : 0) + b.sources.length * 3;
                return sb - sa;
            })
            .slice(0, 15);

        const predsToVerify = allPredictions.slice(0, 5);
        const allToCheck = [...sortedForVerify.map(c => c.value), ...predsToVerify.map(p => p.email)];
        const uniqueEmails = [...new Set(allToCheck.map(e => e.toLowerCase()))];

        // Gravatar (parallel, all, free)
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
                    const nc = addCandidate(candidates, gr.email, 'email', 'Prediction + Gravatar', { isDomainMatch: true });
                    nc.gravatarExists = true;
                }
            }
        }
        sseLog(res, `Gravatar : ${gravHits}/${uniqueEmails.length}`, gravHits > 0 ? 'success' : 'info');

        // SMTP verification — sorted by priority
        const emailsToVerify = candidates
            .filter(c => c.type === 'email' && !c.eliminated && !c.isOtherEmployee)
            .filter(c => {
                const localPart = c.value.split('@')[0].toLowerCase().replace(/-/g, '');
                return !GENERIC_LOCAL_PARTS.has(localPart);
            })
            .sort((a, b) => {
                const aApi = a.sources.some(s => s.includes('Apollo') || s.includes('Hunter Finder') || s.includes('Snov')) ? 100 : 0;
                const bApi = b.sources.some(s => s.includes('Apollo') || s.includes('Hunter Finder') || s.includes('Snov')) ? 100 : 0;
                const aHunterMatch = a.sources.some(s => s.includes('match nom')) ? 50 : 0;
                const bHunterMatch = b.sources.some(s => s.includes('match nom')) ? 50 : 0;
                const aPred = a.sources.some(s => s.includes('Prediction') || s.includes('Prédiction')) ? 30 : 0;
                const bPred = b.sources.some(s => s.includes('Prediction') || s.includes('Prédiction')) ? 30 : 0;
                const aProx = a.proximity ? 20 : 0;
                const bProx = b.proximity ? 20 : 0;
                return (bApi + bHunterMatch + bPred + bProx) - (aApi + aHunterMatch + aPred + aProx);
            })
            .slice(0, 10);

        const predictionsToVerify = [];
        for (const pred of allPredictions) {
            if (predictionsToVerify.length >= 5) break;
            const predDomain = pred.email.split('@')[1];
            const domainInfo = allDomains.get(predDomain);
            if (domainInfo?.catchAll !== true && domainInfo?.mx?.valid && !findCandidate(candidates, pred.email, 'email')) {
                predictionsToVerify.push(pred);
            }
        }

        let hunterVerifyCount = 0;
        let abstractVerifyCount = 0;
        const HUNTER_LIMIT = 10;
        const ABSTRACT_LIMIT = 10;

        // Hunter verify on candidates
        if (KEYS.hunter && !exhaustedApis.has('hunter_verify')) {
            sseLog(res, `Hunter Verify : ${emailsToVerify.length} candidats a trier...`, 'verify');
            for (const cand of emailsToVerify) {
                if (hunterVerifyCount >= HUNTER_LIMIT || exhaustedApis.has('hunter_verify')) break;
                if (cand.hunterVerified) continue;
                const emailDomain = cand.value.split('@')[1];
                const domainInfo = allDomains.get(emailDomain);
                if (domainInfo?.catchAll === true) {
                    sseLog(res, `Skip ${cand.value} (catch-all)`, 'info');
                    continue;
                }
                try {
                    const vr = await hunterVerify(cand.value, exhaustedApis);
                    if (vr && vr._quotaExceeded) {
                        sseLog(res, `Hunter Verify : quota epuise (${hunterVerifyCount} verifs effectuees)`, 'warn');
                        break;
                    }
                    hunterVerifyCount++;
                    if (vr) {
                        cand.hunterVerified = vr;
                        const icon = (vr.status === 'valid' || vr.result === 'deliverable') ? 'OK' : vr.status === 'invalid' ? 'KO' : '??';
                        sseLog(res, `Hunter ${cand.value} : ${icon} ${vr.status}`, (vr.status === 'valid' || vr.result === 'deliverable') ? 'success' : vr.status === 'invalid' ? 'error' : 'info');
                    }
                } catch (e) { sseLog(res, `Hunter ${cand.value} : erreur (${e.message})`, 'warn'); }
                await sleep(200);
            }

            // Verify predictions on non catch-all
            for (const pred of predictionsToVerify) {
                if (hunterVerifyCount >= HUNTER_LIMIT + 5 || exhaustedApis.has('hunter_verify')) break;
                if (findCandidate(candidates, pred.email, 'email')) continue;
                try {
                    const vr = await hunterVerify(pred.email, exhaustedApis);
                    if (vr && vr._quotaExceeded) break;
                    hunterVerifyCount++;
                    if (vr && (vr.status === 'valid' || vr.result === 'deliverable')) {
                        sseLog(res, `Prediction verifiee : <strong>${pred.email}</strong>`, 'success');
                        const nc = addCandidate(candidates, pred.email, 'email', 'Prédiction vérifiée', { isDomainMatch: true });
                        nc.hunterVerified = vr;
                    } else if (vr) {
                        sseLog(res, `Prediction ${pred.email} : ${vr.status || 'inconnu'}`, 'info');
                    }
                } catch (e) { log(`Prediction verify error: ${e.message}`); }
                await sleep(200);
            }
        } else if (KEYS.hunter && exhaustedApis.has('hunter_verify')) {
            sseLog(res, `Hunter Verify : quota deja epuise, skip`, 'warn');
        }

        // Abstract verify — fallback
        const useAbstract = KEYS.abstract && (!KEYS.hunter || exhaustedApis.has('hunter_verify'));
        if (useAbstract && !exhaustedApis.has('abstract')) {
            sseLog(res, `Abstract Verify${exhaustedApis.has('hunter_verify') ? ' (Hunter epuise, fallback)' : ' (pas de Hunter)'}...`, 'verify');
            for (const cand of emailsToVerify) {
                if (abstractVerifyCount >= ABSTRACT_LIMIT || exhaustedApis.has('abstract')) break;
                if (cand.abstractVerified) continue;
                const emailDomain = cand.value.split('@')[1];
                const domainInfo = allDomains.get(emailDomain);
                if (domainInfo?.catchAll === true) continue;
                try {
                    const av = await abstractVerify(cand.value, exhaustedApis);
                    if (av && av._quotaExceeded) {
                        sseLog(res, `Abstract : quota epuise`, 'warn');
                        break;
                    }
                    abstractVerifyCount++;
                    if (av) {
                        cand.abstractVerified = av;
                        const icon = av.deliverability === 'DELIVERABLE' ? 'OK' : av.deliverability === 'UNDELIVERABLE' ? 'KO' : '??';
                        sseLog(res, `Abstract ${cand.value} : ${icon} ${av.deliverability}`, av.deliverability === 'DELIVERABLE' ? 'success' : 'warn');
                    }
                } catch (e) { sseLog(res, `Abstract ${cand.value} : erreur (${e.message})`, 'warn'); }
                await sleep(200);
            }
        } else if (KEYS.abstract && KEYS.hunter && !exhaustedApis.has('hunter_verify')) {
            sseLog(res, `Abstract desactive (Hunter prioritaire)`, 'info');
        }

        sseLog(res, `Credits utilises : Hunter ${hunterVerifyCount} verifs, Abstract ${abstractVerifyCount} verifs`, 'info');

        // ========================================
        // STEP 10: SCORING
        // ========================================
        sseProgress(res, 10, TOTAL_STEPS, 'Scoring multi-criteres...');
        computeScores(candidates, allDomains, hunterPattern, name, pappersInfo);

        for (const c of candidates) {
            if (c.eliminated) continue;
            if (c.type === 'email' && c.isGeneric && !c.proximity && c.score < 10) {
                c.eliminated = true;
                c.eliminatedReason = 'Email generique sans lien';
                continue;
            }
            const hasStrongSource = c.sources.some(s =>
                s.includes('Apollo') || s.includes('Hunter Finder') || s.includes('Snov') || s.includes('Prédiction vérifiée')
            );
            if (hasStrongSource) continue;
            if (c.score < 10 && c.score > 0) {
                c.eliminated = true;
                c.eliminatedReason = 'Score trop bas et aucune source fiable';
            }
        }

        // ========================================
        // STEP 11: RESULTS
        // ========================================
        sseProgress(res, 11, TOTAL_STEPS, 'Finalisation...');

        const elapsed = ((Date.now() - scanStart) / 1000).toFixed(1);
        const mainActive = candidates.filter(c => !c.eliminated && !c.isOtherEmployee);
        const otherEmployees = candidates.filter(c => !c.eliminated && c.isOtherEmployee && c.score > 0).sort((a, b) => b.score - a.score);
        const eliminated = candidates.filter(c => c.eliminated);

        const verified = mainActive.filter(c => c.score >= 90).sort((a, b) => b.score - a.score);
        const probable = mainActive.filter(c => c.score >= 60 && c.score < 90).sort((a, b) => b.score - a.score);
        const possible = mainActive.filter(c => c.score >= 30 && c.score < 60).sort((a, b) => b.score - a.score);
        const low = mainActive.filter(c => c.score >= 10 && c.score < 30);

        sseLog(res, `Termine en ${elapsed}s. ${verified.length} verifies, ${probable.length} probables, ${possible.length} possibles, ${eliminated.length + low.length} elimines/ignores.`, 'success');

        const clean = c => ({
            value: c.value, type: c.type, sources: c.sources, proofs: c.proofs, warnings: c.warnings || [], score: c.score,
            eliminated: c.eliminated, eliminatedReason: c.eliminatedReason,
            proximity: c.proximity, isDomainMatch: c.isDomainMatch, isGeneric: c.isGeneric,
            apolloTitle: c.apolloTitle, apolloLinkedin: c.apolloLinkedin,
        });

        const predsFiltered = allPredictions.filter(p => !findCandidate(candidates, p.email, 'email'));

        const seenUrls = new Set();
        const uniqueSources = sources.filter(s => { if (seenUrls.has(s.url)) return false; seenUrls.add(s.url); return true; });

        const domainsInfo = {};
        for (const [d, info] of allDomains) {
            domainsInfo[d] = { mxValid: info.mx?.valid || false, catchAll: info.catchAll, source: info.source };
        }

        sseDone(res, {
            elapsed: parseFloat(elapsed), domain, domainsInfo, hunterPattern, pappersInfo,
            verified: verified.map(clean), probable: probable.map(clean), possible: possible.map(clean),
            otherEmployees: otherEmployees.map(clean),
            eliminated: [...eliminated, ...low].map(clean),
            predictions: predsFiltered.slice(0, 20),
            sources: uniqueSources,
            dorks: generateDorks(fullname, company, domain),
            summary: { verified: verified.length, probable: probable.length, possible: possible.length, otherEmployees: otherEmployees.length, eliminated: eliminated.length + low.length, sources: uniqueSources.length }
        });

    } catch (err) {
        sseLog(res, `Erreur fatale : ${err.message}`, 'error');
        log(`FATAL: ${err.stack}`);
        sseDone(res, { error: err.message, elapsed: ((Date.now() - scanStart) / 1000).toFixed(1) });
    }
}

module.exports = { scanRoute, statusRoute };
