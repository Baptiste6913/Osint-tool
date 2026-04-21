// ================================================================
// API: APOLLO (people match + enrichment)
// ================================================================
const { fetchWithTimeout, isQuotaError, log } = require('../helpers');
const { KEYS, TIMEOUTS } = require('../config');

async function apolloFindPerson(domain, name, companyName, exhausted) {
    if (!KEYS.apollo || (exhausted && exhausted.has('apollo'))) return null;
    try {
        const r = await fetchWithTimeout('https://api.apollo.io/api/v1/people/match', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': KEYS.apollo },
            body: JSON.stringify({ first_name: name.firstOg, last_name: name.lastOg, organization_name: companyName, domain }),
        }, TIMEOUTS.APOLLO);
        if (isQuotaError(r.status, await r.clone().text().catch(() => ''))) {
            if (exhausted) exhausted.add('apollo');
            return { _quotaExceeded: true };
        }
        const data = await r.json();
        const p = data.person;
        if (!p) return null;

        const phones = [];
        if (p.phone_numbers && Array.isArray(p.phone_numbers)) {
            for (const ph of p.phone_numbers) {
                const num = ph.sanitized_number || ph.raw_number || ph.number;
                if (num && !phones.includes(num)) phones.push(num);
            }
        }
        if (p.phone && !phones.includes(p.phone)) phones.push(p.phone);
        if (p.organization?.phone && !phones.includes(p.organization.phone)) phones.push(p.organization.phone);
        if (p.contact?.phone_numbers) {
            for (const ph of p.contact.phone_numbers) {
                const num = ph.sanitized_number || ph.raw_number;
                if (num && !phones.includes(num)) phones.push(num);
            }
        }

        return {
            email: p.email || null,
            phones,
            linkedin: p.linkedin_url || null,
            title: p.title || null,
            city: p.city || null,
            name: `${p.first_name || ''} ${p.last_name || ''}`.trim(),
            orgDomain: p.organization?.primary_domain || null,
            orgName: p.organization?.name || null,
        };
    } catch (e) { log(`Apollo error: ${e.message}`); }
    return null;
}

module.exports = { apolloFindPerson };
