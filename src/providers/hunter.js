// ================================================================
// API: HUNTER (finder + domain search + verify)
// + inférence de pattern maison si Hunter n'en retourne pas
// ================================================================
const { fetchWithTimeout, fetchWithRetry, isQuotaError, log } = require('../helpers');
const { KEYS, TIMEOUTS } = require('../config');
const { inferPattern } = require('../pattern-inference');

async function hunterFinder(domain, name, exhausted) {
    if (!KEYS.hunter || (exhausted && exhausted.has('hunter'))) return null;
    try {
        const r = await fetchWithRetry(
            `https://api.hunter.io/v2/email-finder?domain=${encodeURIComponent(domain)}&first_name=${encodeURIComponent(name.firstOg)}&last_name=${encodeURIComponent(name.lastOg)}&api_key=${encodeURIComponent(KEYS.hunter)}`,
            {}, TIMEOUTS.HUNTER
        );
        if (isQuotaError(r.status, await r.clone().text().catch(() => ''))) {
            if (exhausted) exhausted.add('hunter');
            return { _quotaExceeded: true };
        }
        const data = await r.json();
        if (data.data?.email) return { email: data.data.email, score: data.data.score || 0, position: data.data.position || '' };
    } catch (e) { log(`Hunter Finder error: ${e.message}`); }
    return null;
}

async function hunterDomain(domain, exhausted) {
    if (!KEYS.hunter || (exhausted && exhausted.has('hunter'))) return { emails: [], pattern: null };
    try {
        const r = await fetchWithRetry(
            `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&api_key=${encodeURIComponent(KEYS.hunter)}&limit=10`,
            {}, TIMEOUTS.HUNTER
        );
        if (isQuotaError(r.status, await r.clone().text().catch(() => ''))) {
            if (exhausted) exhausted.add('hunter');
            return { emails: [], pattern: null, _quotaExceeded: true };
        }
        const data = await r.json();
        const raw = data.data?.emails || [];
        const emails = raw.map(e => ({
            email: e.value,
            confidence: e.confidence || 0,
            position: e.position || '',
            first_name: e.first_name || '',
            last_name: e.last_name || '',
            name: `${e.first_name || ''} ${e.last_name || ''}`.trim(),
        }));

        // Pattern Hunter officiel OU inférence maison si null
        let pattern = data.data?.pattern || null;
        let patternSource = pattern ? 'hunter' : null;
        if (!pattern && emails.length >= 3) {
            const inferred = inferPattern(emails);
            if (inferred && inferred.confidence >= 0.5) {
                pattern = inferred.pattern;
                patternSource = `inferred (${inferred.voters}/${inferred.total})`;
                log(`Pattern inféré pour ${domain}: ${pattern} (${(inferred.confidence * 100).toFixed(0)}%)`);
            }
        }

        return { emails, pattern, patternSource };
    } catch (e) { log(`Hunter Domain error: ${e.message}`); }
    return { emails: [], pattern: null };
}

async function hunterVerify(email, exhausted) {
    if (!KEYS.hunter || (exhausted && exhausted.has('hunter_verify'))) return null;
    try {
        const r = await fetchWithRetry(
            `https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(email)}&api_key=${encodeURIComponent(KEYS.hunter)}`,
            {}, TIMEOUTS.HUNTER
        );
        if (isQuotaError(r.status, await r.clone().text().catch(() => ''))) {
            if (exhausted) exhausted.add('hunter_verify');
            return { _quotaExceeded: true };
        }
        const data = await r.json();
        if (data.data) return { status: data.data.status, result: data.data.result, score: data.data.score };
    } catch (e) { log(`Hunter Verify error: ${e.message}`); }
    return null;
}

module.exports = { hunterFinder, hunterDomain, hunterVerify };
