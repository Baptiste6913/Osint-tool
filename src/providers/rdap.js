// ================================================================
// RDAP (WHOIS moderne) — Gratuit, sans clé, illimité
// Retourne les registrant infos (email parfois) + nom organisation
// Fallback WHOIS brut via whoxy si besoin.
// ================================================================
const { fetchWithRetry, log } = require('../helpers');
const { TIMEOUTS } = require('../config');

async function rdapLookup(domain) {
    try {
        // IANA bootstrap via rdap.org proxy
        const r = await fetchWithRetry(
            `https://rdap.org/domain/${encodeURIComponent(domain)}`,
            { headers: { 'Accept': 'application/rdap+json' } },
            TIMEOUTS.RDAP
        );
        if (!r.ok) return null;
        const data = await r.json();
        const result = { emails: [], orgs: [], names: [] };

        for (const ent of (data.entities || [])) {
            // vCard array : [["version", {}, "text", "4.0"], ["fn", {}, "text", "NAME"], ["email", {}, "text", "x@y"]]
            const vcard = ent.vcardArray?.[1];
            if (!Array.isArray(vcard)) continue;
            for (const item of vcard) {
                if (!Array.isArray(item)) continue;
                const [field, , , value] = item;
                if (field === 'email' && typeof value === 'string' && /@/.test(value)) {
                    result.emails.push({ email: value.toLowerCase(), role: (ent.roles || []).join(',') });
                } else if (field === 'org' && typeof value === 'string') {
                    result.orgs.push(value);
                } else if (field === 'fn' && typeof value === 'string') {
                    result.names.push(value);
                }
            }
        }
        return result;
    } catch (e) { log(`RDAP error for ${domain}: ${e.message}`); }
    return null;
}

module.exports = { rdapLookup };
