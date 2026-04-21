// ================================================================
// API: HUNTER (finder + domain search + verify)
// ================================================================
const { fetchWithTimeout, isQuotaError, log } = require('../helpers');
const { KEYS, TIMEOUTS } = require('../config');

async function hunterFinder(domain, name, exhausted) {
    if (!KEYS.hunter || (exhausted && exhausted.has('hunter'))) return null;
    try {
        const r = await fetchWithTimeout(
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
        const r = await fetchWithTimeout(
            `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&api_key=${encodeURIComponent(KEYS.hunter)}&limit=10`,
            {}, TIMEOUTS.HUNTER
        );
        if (isQuotaError(r.status, await r.clone().text().catch(() => ''))) {
            if (exhausted) exhausted.add('hunter');
            return { emails: [], pattern: null, _quotaExceeded: true };
        }
        const data = await r.json();
        const emails = (data.data?.emails || []).map(e => ({
            email: e.value, confidence: e.confidence || 0, position: e.position || '',
            name: `${e.first_name || ''} ${e.last_name || ''}`.trim()
        }));
        return { emails, pattern: data.data?.pattern || null };
    } catch (e) { log(`Hunter Domain error: ${e.message}`); }
    return { emails: [], pattern: null };
}

async function hunterVerify(email, exhausted) {
    if (!KEYS.hunter || (exhausted && exhausted.has('hunter_verify'))) return null;
    try {
        const r = await fetchWithTimeout(
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
