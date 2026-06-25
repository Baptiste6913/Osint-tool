// ================================================================
// API: SERPER.DEV — Fallback moteur de recherche (Google SERP)
// 2 500 recherches gratuites à l'inscription
// ================================================================
const { fetchWithRetry, isQuotaError, log } = require('../helpers');
const { KEYS, TIMEOUTS } = require('../config');

async function serperSearch(query, options = {}) {
    if (!KEYS.serper) return [];
    try {
        const r = await fetchWithRetry('https://google.serper.dev/search', {
            method: 'POST',
            headers: { 'X-API-KEY': KEYS.serper, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                q: query,
                num: options.num || 10,
                gl: options.gl || 'fr',
                hl: options.hl || 'fr',
            }),
        }, TIMEOUTS.SERPER);
        if (isQuotaError(r.status, await r.clone().text().catch(() => ''))) {
            log('Serper quota épuisé');
            return [];
        }
        if (!r.ok) return [];
        const data = await r.json();
        const results = [];
        // Organic results
        for (const res of (data.organic || [])) {
            results.push({
                title: res.title || '',
                url: res.link || '',
                content: res.snippet || '',
                description: res.snippet || '',
            });
        }
        // People also ask (bonus)
        for (const paa of (data.peopleAlsoAsk || [])) {
            if (paa.snippet) {
                results.push({
                    title: paa.question || '',
                    url: paa.link || '',
                    content: paa.snippet,
                    description: paa.snippet,
                });
            }
        }
        return results;
    } catch (e) { log(`Serper error: ${e.message}`); }
    return [];
}

module.exports = { serperSearch };
