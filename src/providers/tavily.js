// ================================================================
// API: TAVILY — 2e fallback moteur de recherche (1000/mois free)
// ================================================================
const { fetchWithRetry, log } = require('../helpers');
const { KEYS, TIMEOUTS } = require('../config');

async function tavilySearch(query, options = {}) {
    if (!KEYS.tavily) return [];
    try {
        const r = await fetchWithRetry('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                api_key: KEYS.tavily,
                query,
                search_depth: 'basic',
                max_results: options.num || 8,
                include_answer: false,
            }),
        }, TIMEOUTS.TAVILY);
        if (!r.ok) return [];
        const data = await r.json();
        return (data.results || []).map(r => ({
            title: r.title || '',
            url: r.url || '',
            content: r.content || '',
            description: r.content || '',
        }));
    } catch (e) { log(`Tavily error: ${e.message}`); }
    return [];
}

module.exports = { tavilySearch };
