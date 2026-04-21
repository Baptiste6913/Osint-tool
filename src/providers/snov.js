// ================================================================
// API: SNOV.IO (OAuth + email finder)
// ================================================================
const { fetchWithTimeout, isQuotaError, log } = require('../helpers');
const { KEYS, TIMEOUTS, snovTokenCache } = require('../config');

async function snovGetToken() {
    if (snovTokenCache.token && Date.now() < snovTokenCache.expiresAt) return snovTokenCache.token;
    if (!KEYS.snovId || !KEYS.snovSecret) return null;
    try {
        const r = await fetchWithTimeout('https://api.snov.io/v1/oauth/access_token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ grant_type: 'client_credentials', client_id: KEYS.snovId, client_secret: KEYS.snovSecret }),
        }, TIMEOUTS.SNOV);
        const data = await r.json();
        if (data.access_token) {
            snovTokenCache.token = data.access_token;
            snovTokenCache.expiresAt = Date.now() + 3500000;
            return data.access_token;
        }
    } catch (e) { log(`Snov Auth error: ${e.message}`); }
    return null;
}

async function snovFindEmail(domain, name, exhausted) {
    if (exhausted && exhausted.has('snov')) return [];
    const token = await snovGetToken();
    if (!token) return [];
    try {
        const r = await fetchWithTimeout('https://api.snov.io/v1/get-emails-from-names', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ access_token: token, firstName: name.firstOg, lastName: name.lastOg, domain }),
        }, TIMEOUTS.SNOV);
        if (isQuotaError(r.status, await r.clone().text().catch(() => ''))) {
            if (exhausted) exhausted.add('snov');
            return [{ _quotaExceeded: true }];
        }
        const data = await r.json();
        if (data.success && data.data?.emails) return data.data.emails.map(e => ({ email: e.email, status: e.emailStatus || 'unknown' }));
    } catch (e) { log(`Snov Find error: ${e.message}`); }
    return [];
}

module.exports = { snovGetToken, snovFindEmail };
