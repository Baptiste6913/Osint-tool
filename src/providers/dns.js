// ================================================================
// API: DNS MX (via dns.google)
// ================================================================
const { fetchWithTimeout, log } = require('../helpers');
const { TIMEOUTS } = require('../config');

async function checkMX(domain) {
    try {
        const r = await fetchWithTimeout(
            `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=MX`,
            {}, TIMEOUTS.DNS
        );
        if (!r.ok) return { valid: null, records: [] };
        const data = await r.json();
        const records = (data.Answer || []).filter(a => a.type === 15).map(a => a.data);
        return { valid: records.length > 0, records };
    } catch (e) {
        log(`checkMX error for ${domain}: ${e.message}`);
        return { valid: null, records: [] };
    }
}

module.exports = { checkMX };
