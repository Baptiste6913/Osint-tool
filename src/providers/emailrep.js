// ================================================================
// EMAILREP.IO — 2e vérification + réputation email
// 100 req/jour sans clé, 1000/jour avec clé gratuite
// ================================================================
const { fetchWithRetry, isQuotaError, log } = require('../helpers');
const { KEYS, TIMEOUTS } = require('../config');

async function emailRepCheck(email, exhausted) {
    if (exhausted && exhausted.has('emailrep')) return null;
    try {
        const headers = { 'Accept': 'application/json', 'User-Agent': 'osint-contact-finder' };
        if (KEYS.emailrep) headers['Key'] = KEYS.emailrep;

        const r = await fetchWithRetry(
            `https://emailrep.io/${encodeURIComponent(email)}`,
            { headers }, TIMEOUTS.EMAILREP
        );
        if (isQuotaError(r.status, '')) {
            if (exhausted) exhausted.add('emailrep');
            return { _quotaExceeded: true };
        }
        if (!r.ok) return null;
        const data = await r.json();
        return {
            reputation: data.reputation,          // "high" | "medium" | "low" | "none"
            suspicious: data.suspicious,
            references: data.references || 0,     // nb sources publiques
            detailsCredentialsLeaked: data.details?.credentials_leaked || false,
            detailsDataBreach: data.details?.data_breach || false,
            detailsProfilesFound: data.details?.profiles || [],
            malicious: data.details?.malicious_activity || false,
            blacklisted: data.details?.blacklisted || false,
            freeProvider: data.details?.free_provider || false,
            deliverable: data.details?.deliverable || null,
        };
    } catch (e) { log(`EmailRep error: ${e.message}`); }
    return null;
}

module.exports = { emailRepCheck };
