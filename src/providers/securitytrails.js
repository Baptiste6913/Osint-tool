// ================================================================
// SECURITYTRAILS — Énumération de sous-domaines (50/mois free)
// Utile pour découvrir contact.company.com, team.company.com, etc.
// ================================================================
const { fetchWithRetry, isQuotaError, log } = require('../helpers');
const { KEYS, TIMEOUTS } = require('../config');

async function securitytrailsSubdomains(domain, exhausted) {
    if (!KEYS.securitytrails || (exhausted && exhausted.has('securitytrails'))) return [];
    try {
        const r = await fetchWithRetry(
            `https://api.securitytrails.com/v1/domain/${encodeURIComponent(domain)}/subdomains?children_only=true`,
            { headers: { 'APIKEY': KEYS.securitytrails } },
            TIMEOUTS.SECURITYTRAILS
        );
        if (isQuotaError(r.status, '')) {
            if (exhausted) exhausted.add('securitytrails');
            return [];
        }
        if (!r.ok) return [];
        const data = await r.json();
        return (data.subdomains || []).map(s => `${s}.${domain}`);
    } catch (e) { log(`SecurityTrails error: ${e.message}`); }
    return [];
}

module.exports = { securitytrailsSubdomains };
