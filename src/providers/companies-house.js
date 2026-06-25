// ================================================================
// UK COMPANIES HOUSE — Equivalent UK de Pappers
// Gratuit avec clé (https://developer-specs.company-information.service.gov.uk)
// ================================================================
const { fetchWithRetry, log } = require('../helpers');
const { KEYS, TIMEOUTS } = require('../config');

function authHeader() {
    // Basic auth avec clé : clé comme username, password vide
    const token = Buffer.from(`${KEYS.companieshouse}:`).toString('base64');
    return { 'Authorization': `Basic ${token}` };
}

async function companiesHouseSearch(companyName) {
    if (!KEYS.companieshouse) return null;
    try {
        const r = await fetchWithRetry(
            `https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(companyName)}&items_per_page=5`,
            { headers: authHeader() },
            TIMEOUTS.COMPANIES_HOUSE
        );
        if (!r.ok) return null;
        const data = await r.json();
        if (!data.items || data.items.length === 0) return null;
        const best = data.items[0];

        // Fetch officers
        const officers = [];
        try {
            const or = await fetchWithRetry(
                `https://api.company-information.service.gov.uk/company/${best.company_number}/officers`,
                { headers: authHeader() },
                TIMEOUTS.COMPANIES_HOUSE
            );
            if (or.ok) {
                const od = await or.json();
                for (const o of (od.items || [])) {
                    officers.push({
                        name: o.name,
                        role: o.officer_role,
                        appointedOn: o.appointed_on,
                        nationality: o.nationality,
                    });
                }
            }
        } catch (e) { log(`CompaniesHouse officers error: ${e.message}`); }

        return {
            name: best.title,
            number: best.company_number,
            status: best.company_status,
            address: best.address_snippet,
            officers,
        };
    } catch (e) { log(`CompaniesHouse error: ${e.message}`); }
    return null;
}

module.exports = { companiesHouseSearch };
