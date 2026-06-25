// ================================================================
// COMMON CRAWL — Index global du web (gratuit, illimité)
// On cherche des URLs mentionnant un domaine pour découvrir pages tierces
// (annuaires, CV, interviews) qui contiennent l'email.
// ================================================================
const { fetchWithRetry, log } = require('../helpers');
const { TIMEOUTS } = require('../config');

// Liste des index disponibles (trié du plus récent)
const LATEST_INDEX = 'CC-MAIN-2025-05'; // À mettre à jour périodiquement

async function commonCrawlSearch(domain, limit = 10) {
    try {
        const r = await fetchWithRetry(
            `https://index.commoncrawl.org/${LATEST_INDEX}-index?url=${encodeURIComponent(domain)}&output=json&limit=${limit}`,
            { headers: { 'User-Agent': 'osint-contact-finder' } },
            15000
        );
        if (!r.ok) return [];
        const text = await r.text();
        // NDJSON
        return text.split('\n').filter(Boolean).map(line => {
            try { return JSON.parse(line); } catch { return null; }
        }).filter(Boolean).map(rec => ({
            url: rec.url,
            timestamp: rec.timestamp,
            mime: rec.mime,
            status: rec.status,
        }));
    } catch (e) { log(`CommonCrawl error: ${e.message}`); }
    return [];
}

module.exports = { commonCrawlSearch };
