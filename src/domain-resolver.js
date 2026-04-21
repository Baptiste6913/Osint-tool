// ================================================================
// DOMAIN RESOLVER — Resolution, hints, regional, catch-all
// ================================================================
const { checkMX } = require('./providers/dns');
const { jinaSearch } = require('./providers/jina');
const { hunterVerify } = require('./providers/hunter');
const { abstractVerify } = require('./providers/abstract');
const { normalize, log } = require('./helpers');
const { AGGREGATOR_DOMAINS, KEYS } = require('./config');
const { sseLog } = require('./sse');

// ================================================================
// CATCH-ALL DETECTION
// ================================================================
async function detectCatchAll(domain, exhausted) {
    const fakeEmail = `xz9q8w7test${Date.now()}@${domain}`;

    if (KEYS.hunter && !(exhausted && exhausted.has('hunter_verify'))) {
        try {
            const result = await hunterVerify(fakeEmail, exhausted);
            if (result && result._quotaExceeded) { /* skip, quota hit */ }
            else if (result) {
                if (result.status === 'accept_all' || (result.result === 'deliverable' && result.status !== 'valid')) return true;
                if (result.status === 'invalid' || result.result === 'undeliverable') return false;
            }
        } catch (e) { log(`detectCatchAll Hunter error for ${domain}: ${e.message}`); }
    }

    if (KEYS.abstract && !(exhausted && exhausted.has('abstract'))) {
        try {
            const result = await abstractVerify(fakeEmail, exhausted);
            if (result && result._quotaExceeded) { /* skip */ }
            else if (result) {
                if (result.catchall === true) return true;
                if (result.deliverability === 'DELIVERABLE') return true;
                if (result.deliverability === 'UNDELIVERABLE') return false;
            }
        } catch (e) { log(`detectCatchAll Abstract error for ${domain}: ${e.message}`); }
    }

    return null;
}

// ================================================================
// DOMAIN RESOLUTION (Jina search -> TLD brute-force)
// ================================================================
async function resolveDomain(companyName, rawDomain, res) {
    if (rawDomain.includes('.')) return rawDomain;

    // Strategy A: Jina search for official site
    if (KEYS.jina) {
        try {
            sseLog(res, `Recherche du domaine pour "${companyName}"...`, 'search');
            const results = await jinaSearch(`"${companyName}" site officiel`, { num: 5 });
            for (const r of results) {
                if (!r.url) continue;
                try {
                    const host = new URL(r.url).hostname.replace(/^www\./, '');
                    if (AGGREGATOR_DOMAINS.some(d => host.includes(d))) continue;
                    const mx = await checkMX(host);
                    if (mx.valid) {
                        sseLog(res, `Domaine via recherche : <strong>${host}</strong>`, 'success');
                        return host;
                    }
                } catch (e) { log(`resolveDomain URL parse error: ${e.message}`); }
            }
            // Strategy A2: search for email @domain in results
            const emailResults = await jinaSearch(`"${companyName}" email @`, { num: 3 });
            for (const r of emailResults) {
                const content = [r.content, r.description].filter(Boolean).join(' ');
                const emailMatch = content.match(/[\w.-]+@([\w.-]+\.\w{2,})/);
                if (emailMatch) {
                    const d = emailMatch[1].toLowerCase();
                    if (!AGGREGATOR_DOMAINS.some(ad => d.includes(ad))) {
                        const mx = await checkMX(d);
                        if (mx.valid) {
                            sseLog(res, `Domaine via email trouve : <strong>${d}</strong>`, 'success');
                            return d;
                        }
                    }
                }
            }
        } catch (e) { sseLog(res, `Recherche domaine echouee : ${e.message}`, 'warn'); }
    }

    // Strategy B: Smart TLD brute-force
    sseLog(res, `Test TLDs avec variantes de nom...`, 'search');
    const stopWords = new Set(['de','du','des','le','la','les','et','en','au','aux','un','une','sa','sas','sarl']);
    const words = companyName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .split(/\s+/).filter(w => w.length > 1 && !stopWords.has(w));

    const domainCandidates = [];
    const full = words.join('');
    if (full.length <= 20) domainCandidates.push(full);
    const hyphenated = words.join('-');
    if (hyphenated.length <= 25) domainCandidates.push(hyphenated);
    if (words.length >= 2) {
        const initials = words.slice(0, -1).map(w => w[0]).join('');
        const lastWord = words[words.length - 1];
        domainCandidates.push(`${initials}-${lastWord}`, `${initials}${lastWord}`);
    }
    if (words.length >= 2) {
        domainCandidates.push(`${words[0]}-${words[words.length - 1]}`, `${words[0]}${words[words.length - 1]}`);
    }
    domainCandidates.push(rawDomain);

    const tlds = ['.fr', '.com', '.eu', '.org', '.net'];
    for (const base of [...new Set(domainCandidates)]) {
        for (const tld of tlds) {
            const candidate = base + tld;
            const mx = await checkMX(candidate);
            if (mx.valid) {
                sseLog(res, `Domaine via MX : <strong>${candidate}</strong>`, 'success');
                return candidate;
            }
        }
    }

    sseLog(res, `Aucun domaine resolu — fallback ${rawDomain}.com`, 'warn');
    return rawDomain + '.com';
}

// ================================================================
// DOMAIN HINT EXTRACTION (from Jina URLs)
// ================================================================
function extractDomainHintsFromUrls(jinaResults, companyName, mainDomain) {
    const hints = new Set();
    const companyWords = companyName.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .split(/\s+/).filter(w => w.length > 3);

    for (const r of jinaResults) {
        if (!r.url) continue;
        try {
            const urlObj = new URL(r.url);
            const host = urlObj.hostname.replace(/^www\./, '');

            if (host !== mainDomain && !AGGREGATOR_DOMAINS.some(d => host.includes(d))) {
                hints.add(host);
            }

            const segments = urlObj.pathname.toLowerCase().split('/').filter(s => s.length > 3 && /^[a-z0-9-]+$/.test(s));
            for (const seg of segments) {
                if (companyWords.some(w => seg.includes(w.substring(0, 4)))) {
                    hints.add(seg + '.fr');
                    hints.add(seg + '.com');
                }
            }
        } catch (e) { log(`extractDomainHints URL parse error: ${e.message}`); }
    }

    hints.delete(mainDomain);
    hints.delete('www.' + mainDomain);
    return hints;
}

// ================================================================
// REGIONAL DOMAIN GUESSING
// ================================================================
function guessRegionalDomains(companyName, mainDomain) {
    const hints = new Set();
    const clean = companyName.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const stopWords = new Set(['de','du','des','le','la','les','et','en','au','aux','un','une','sa','sas','sarl',
        'credit','agricole','caisse','regionale','mutuel','banque','societe','generale','groupe','federation']);
    const words = clean.split(/\s+/).filter(w => w.length > 3 && !stopWords.has(w));
    if (words.length === 0) return hints;

    const mainParts = mainDomain.split('.');
    const mainBase = mainParts[0];
    const mainTld = mainParts.slice(1).join('.') || 'fr';

    const baseParts = mainBase.split('-');
    if (baseParts.length >= 2) {
        const initials = baseParts.map(w => w[0]).join('');
        for (const geo of words) {
            hints.add(`${initials}-${geo}.${mainTld}`);
            if (mainTld !== 'fr') hints.add(`${initials}-${geo}.fr`);
        }
    }

    return hints;
}

module.exports = { detectCatchAll, resolveDomain, extractDomainHintsFromUrls, guessRegionalDomains };
