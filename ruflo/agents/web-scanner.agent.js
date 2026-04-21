// ================================================================
// RUFLO AGENT: web-scanner
// Recherches web Jina + lecture pages + extraction contacts
// Wraps Steps 6 + 7 du pipeline
// ================================================================
const { sseLog } = require('../../src/sse');
const { sleep, shouldReadUrl, log } = require('../../src/helpers');
const { jinaSearch, jinaRead } = require('../../src/providers/jina');
const { extractContactsContextual } = require('../../src/extractors');
const { addCandidate } = require('../../src/candidates');

const AGENT_META = {
    name: 'web-scanner',
    version: '1.0.0',
    description: 'Recherches web Jina + lecture pages + extraction contacts',
    capabilities: ['web-search', 'page-reading', 'contact-extraction'],
    timeout: 60000,
};

async function execute(ctx) {
    const { fullname, company, domain, allDomains, candidates, res } = ctx;

    const searchQueries = [
        { label: 'Contact direct', query: `"${fullname}" "${company}" email contact` },
        { label: 'Coordonnees', query: `"${fullname}" "${company}" mail telephone` },
        { label: 'Profil LinkedIn', query: `"${fullname}" "${company}" linkedin profil` },
        { label: 'Annuaires', query: `"${fullname}" "${company}" societe.com OR pappers OR verif` },
        { label: 'Telephone', query: `"${fullname}" "${company}" telephone OR phone OR "+33"` },
        { label: 'Actualites', query: `"${fullname}" "${company}" interview OR nomination OR article` },
        { label: 'Biographie', query: `"${fullname}" parcours OR biographie OR CV` },
    ];

    const jinaResults = [];
    const sources = [];
    let jinaSuccesses = 0;
    let jinaFailures = 0;
    const BATCH = 3;
    let jinaStopped = false;

    // Step 6: Jina searches
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
        if (allDomains.get(d).mx?.valid) {
            urlsToRead.add(`https://${d}/contact`);
            urlsToRead.add(`https://www.${d}/contact`);
            urlsToRead.add(`https://${d}/about`);
        }
    }
    const pageKw = ['contact', 'team', 'equipe', 'about', 'annuaire', 'profil'];
    for (const r of jinaResults) {
        if (!r.url || !shouldReadUrl(r.url)) continue;
        const ul = r.url.toLowerCase();
        const tl = (r.title || '').toLowerCase();
        if (pageKw.some(k => ul.includes(k) || tl.includes(k))) urlsToRead.add(r.url);
        if (urlsToRead.size >= 8) break;
    }
    const filteredUrls = [...urlsToRead].filter(shouldReadUrl).slice(0, 8);

    let pagesRead = 0;
    for (let bs = 0; bs < filteredUrls.length; bs += BATCH) {
        const batch = filteredUrls.slice(bs, bs + BATCH);
        const proms = batch.map(async (url) => {
            sseLog(res, `Lecture : ${url.replace('https://', '').substring(0, 60)}`, 'search');
            try {
                const pageData = await jinaRead(url);
                if (pageData.content) {
                    const extracted = extractContactsContextual(pageData.content, url, fullname, domain);
                    if (extracted.some(e => e.proximity)) pagesRead++;
                    for (const ex of extracted) addCandidate(candidates, ex.value, ex.type, ex.source, { proximity: ex.proximity, isDomainMatch: ex.isDomainMatch, isGeneric: ex.isGeneric });
                    sources.push({ title: pageData.title || url, url, query: 'Lecture directe' });
                }
            } catch (e) { sseLog(res, `-> inaccessible (${(e.message || '').substring(0, 50)})`, 'warn'); }
        });
        await Promise.allSettled(proms);
        if (bs + BATCH < filteredUrls.length) await sleep(150);
    }

    // Fallback phone search
    const phoneCount = candidates.filter(c => c.type === 'phone' && !c.eliminated).length;
    if (phoneCount === 0) {
        sseLog(res, 'Aucun telephone — recherche standard...', 'search');
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
                        const raw = pm[0].trim();
                        const digits = raw.replace(/\D/g, '');
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

    return { jinaResults, sources, pagesRead };
}

module.exports = { execute, AGENT_META };
