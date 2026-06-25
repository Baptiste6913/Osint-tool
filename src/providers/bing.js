// ================================================================
// API: BING WEB SEARCH — 3e fallback (1000/mois free via Azure)
// ================================================================
const { fetchWithRetry, log } = require('../helpers');
const { KEYS, TIMEOUTS } = require('../config');

async function bingSearch(query, options = {}) {
    if (!KEYS.bing) return [];
    try {
        const r = await fetchWithRetry(
            `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}&count=${options.num || 10}&mkt=${options.mkt || 'fr-FR'}`,
            { headers: { 'Ocp-Apim-Subscription-Key': KEYS.bing } },
            TIMEOUTS.BING
        );
        if (!r.ok) return [];
        const data = await r.json();
        return (data.webPages?.value || []).map(r => ({
            title: r.name || '',
            url: r.url || '',
            content: r.snippet || '',
            description: r.snippet || '',
        }));
    } catch (e) { log(`Bing error: ${e.message}`); }
    return [];
}

module.exports = { bingSearch };
