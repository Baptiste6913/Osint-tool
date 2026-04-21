// ================================================================
// API: JINA (search + reader)
// ================================================================
const { fetchWithTimeout } = require('../helpers');
const { KEYS, TIMEOUTS } = require('../config');

async function jinaSearch(query, options = {}) {
    if (!KEYS.jina) throw new Error('Clé Jina requise');
    const r = await fetchWithTimeout('https://s.jina.ai/', {
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${KEYS.jina}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            q: query,
            num: options.num || 5,
            gl: options.gl || 'fr',
            hl: options.hl || 'fr',
        }),
    }, TIMEOUTS.JINA_SEARCH);
    if (!r.ok) throw new Error(`Jina ${r.status}`);
    const data = await r.json();
    return data.data || [];
}

async function jinaRead(url) {
    if (!KEYS.jina) throw new Error('Clé Jina requise');
    const r = await fetchWithTimeout(`https://r.jina.ai/${url}`, {
        method: 'GET',
        headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${KEYS.jina}`,
            'X-Return-Format': 'text',
            'X-Retain-Images': 'none',
            'X-Timeout': '8',
            'X-Token-Budget': '5000',
        },
    }, TIMEOUTS.JINA_READ);
    if (!r.ok) throw new Error(`Reader ${r.status}`);
    const data = await r.json();
    return data.data || {};
}

module.exports = { jinaSearch, jinaRead };
