// ================================================================
// DOMAIN RESOLVER — Résolution, hints, régional, catch-all
// + TLDs étendus + DNS parallélisé
// ================================================================
const { checkMX } = require('./providers/dns');
const { jinaSearch } = require('./providers/jina');
const { hunterVerify } = require('./providers/hunter');
const { abstractVerify } = require('./providers/abstract');
const { normalize, log } = require('./helpers');
const { AGGREGATOR_DOMAINS, KEYS } = require('./config');
const { sseLog } = require('./sse');
const { getDomainCache, setDomainCache } = require('./cache');

// Liste élargie des TLDs à tester (trié par probabilité)
const TLDS = [
    '.com', '.fr', '.io', '.co', '.ai', '.tech', '.app', '.dev', '.cloud',
    '.eu', '.org', '.net', '.studio', '.group', '.global', '.paris',
    '.agency', '.consulting', '.xyz', '.me', '.store', '.shop',
];

// ================================================================
// CATCH-ALL DETECTION (avec cache)
// ================================================================
async function detectCatchAll(domain, exhausted) {
    // Cache hit ?
    const cached = getDomainCache(domain);
    if (cached && cached.catchAll !== undefined && cached.catchAll !== null) {
        return cached.catchAll;
    }

    const fakeEmail = `xz9q8w7test${Date.now()}@${domain}`;

    let result = null;
    if (KEYS.hunter && !(exhausted && exhausted.has('hunter_verify'))) {
        try {
            const r = await hunterVerify(fakeEmail, exhausted);
            if (r && !r._quotaExceeded) {
                if (r.status === 'accept_all' || (r.result === 'deliverable' && r.status !== 'valid')) result = true;
                else if (r.status === 'invalid' || r.result === 'undeliverable') result = false;
            }
        } catch (e) { log(`detectCatchAll Hunter error for ${domain}: ${e.message}`); }
    }

    if (result === null && KEYS.abstract && !(exhausted && exhausted.has('abstract'))) {
        try {
            const r = await abstractVerify(fakeEmail, exhausted);
            if (r && !r._quotaExceeded) {
                if (r.catchall === true) result = true;
                else if (r.deliverability === 'DELIVERABLE') result = true;
                else if (r.deliverability === 'UNDELIVERABLE') result = false;
            }
        } catch (e) { log(`detectCatchAll Abstract error for ${domain}: ${e.message}`); }
    }

    if (result !== null) setDomainCache(domain, { catchAll: result });
    return result;
}

// ================================================================
// DOMAIN RESOLUTION (Jina search → TLD brute-force parallélisé)
// ================================================================
async function resolveDomain(companyName, rawDomain, res) {
    if (rawDomain.includes('.')) return rawDomain;

    // Cache hit sur companyName
    const cacheKey = `company:${normalize(companyName)}`;
    const cached = getDomainCache(cacheKey);
    if (cached && cached.domain) {
        sseLog(res, `Domaine en cache : <strong>${cached.domain}</strong>`, 'success');
        return cached.domain;
    }

    // Strategy A: Jina search
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
                        setDomainCache(cacheKey, { domain: host });
                        return host;
                    }
                } catch (e) { log(`resolveDomain URL parse error: ${e.message}`); }
            }
            // Strategy A2: emails dans les résultats
            const emailResults = await jinaSearch(`"${companyName}" email @`, { num: 3 });
            for (const r of emailResults) {
                const content = [r.content, r.description].filter(Boolean).join(' ');
                const emailMatch = content.match(/[\w.-]+@([\w.-]+\.\w{2,})/);
                if (emailMatch) {
                    const d = emailMatch[1].toLowerCase();
                    if (!AGGREGATOR_DOMAINS.some(ad => d.includes(ad))) {
                        const mx = await checkMX(d);
                        if (mx.valid) {
                            sseLog(res, `Domaine via email trouvé : <strong>${d}</strong>`, 'success');
                            setDomainCache(cacheKey, { domain: d });
                            return d;
                        }
                    }
                }
            }
        } catch (e) { sseLog(res, `Recherche domaine échouée : ${e.message}`, 'warn'); }
    }

    // Strategy B: TLD brute-force PARALLÉLISÉ (avant: série ; gain : ~90% du temps)
    sseLog(res, `Test TLDs avec variantes de nom (parallèle)...`, 'search');
    const stopWords = new Set(['de','du','des','le','la','les','et','en','au','aux','un','une','sa','sas','sarl']);
    const words = companyName.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        .split(/\s+/).filter(w => w.length > 1 && !stopWords.has(w));

    const bases = new Set();
    const full = words.join('');
    if (full.length <= 20) bases.add(full);
    const hyphenated = words.join('-');
    if (hyphenated.length <= 25) bases.add(hyphenated);
    if (words.length >= 2) {
        const initials = words.slice(0, -1).map(w => w[0]).join('');
        const lastWord = words[words.length - 1];
        bases.add(`${initials}-${lastWord}`);
        bases.add(`${initials}${lastWord}`);
        bases.add(`${words[0]}-${words[words.length - 1]}`);
        bases.add(`${words[0]}${words[words.length - 1]}`);
    }
    bases.add(rawDomain);

    // Génère toutes les (base × tld) et lance TOUTES les DNS lookups en parallèle
    const allCandidates = [];
    for (const base of bases) {
        for (const tld of TLDS) allCandidates.push(base + tld);
    }
    // Limiter pour éviter d'abuser du DNS
    const limited = allCandidates.slice(0, 120);
    const CONCURRENCY = 20;
    const valid = [];

    for (let i = 0; i < limited.length; i += CONCURRENCY) {
        const batch = limited.slice(i, i + CONCURRENCY);
        const checks = await Promise.all(batch.map(async d => {
            const mx = await checkMX(d);
            return { domain: d, valid: mx.valid };
        }));
        for (const c of checks) if (c.valid) valid.push(c.domain);
        // Short-circuit : si on trouve ≥1 match valable, arrêter (le 1er est prio par ordre TLD)
        if (valid.length > 0) break;
    }

    if (valid.length > 0) {
        const best = valid[0];
        sseLog(res, `Domaine via MX parallèle : <strong>${best}</strong>`, 'success');
        setDomainCache(cacheKey, { domain: best });
        return best;
    }

    sseLog(res, `Aucun domaine résolu — fallback ${rawDomain}.com`, 'warn');
    return rawDomain + '.com';
}

// ================================================================
// DOMAIN HINT EXTRACTION (from Jina URLs)
// ================================================================
function extractDomainHintsFromUrls(jinaResults, companyName, mainDomain) {
    const hints = new Set();
    const companyWords = companyName.toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
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
                    // Ajouter plusieurs TLDs par hint
                    for (const tld of ['.fr', '.com', '.io', '.co']) hints.add(seg + tld);
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
        .normalize('NFD').replace(/[̀-ͯ]/g, '');
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

// ================================================================
// Parallelized MX check on a batch of domains.
// Utilisé pour accélérer les loops "pour chaque domaine secondaire"
// ================================================================
async function checkMXBatch(domains) {
    const results = await Promise.all(domains.map(async d => {
        const mx = await checkMX(d);
        return { domain: d, mx };
    }));
    return results;
}

module.exports = {
    detectCatchAll, resolveDomain,
    extractDomainHintsFromUrls, guessRegionalDomains,
    checkMXBatch, TLDS,
};
