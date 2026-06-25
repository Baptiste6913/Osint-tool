// ================================================================
// WAYBACK MACHINE — Lecture des versions archivées des pages contact
// Gratuit, sans clé. Permet de trouver des emails retirés du site.
// ================================================================
const { fetchWithRetry, log } = require('../helpers');
const { TIMEOUTS } = require('../config');

// Liste les snapshots disponibles pour une URL/pattern
async function waybackListSnapshots(urlPattern, limit = 5) {
    try {
        // CDX API : https://github.com/internetarchive/wayback/tree/master/wayback-cdx-server
        const url = `http://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(urlPattern)}&output=json&limit=${limit}&fl=timestamp,original,statuscode&filter=statuscode:200&collapse=digest`;
        const r = await fetchWithRetry(url, {}, TIMEOUTS.WAYBACK);
        if (!r.ok) return [];
        const data = await r.json();
        if (!Array.isArray(data) || data.length < 2) return [];
        // Première ligne = header
        const [, ...rows] = data;
        return rows.map(([timestamp, original]) => ({
            timestamp,
            original,
            archiveUrl: `https://web.archive.org/web/${timestamp}/${original}`,
        }));
    } catch (e) { log(`Wayback CDX error: ${e.message}`); }
    return [];
}

// Récupère le texte archivé d'une page
async function waybackFetch(archiveUrl) {
    try {
        const r = await fetchWithRetry(archiveUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 osint-contact-finder' },
        }, TIMEOUTS.WAYBACK);
        if (!r.ok) return null;
        return await r.text();
    } catch (e) { log(`Wayback fetch error: ${e.message}`); }
    return null;
}

// Workflow combiné : pour un domaine, liste les pages contact/team archivées et récupère le texte.
// Retourne [{url, text, timestamp}]
async function waybackContactPages(domain, maxPages = 3) {
    const patterns = [
        `${domain}/contact*`, `${domain}/team*`, `${domain}/about*`,
        `${domain}/equipe*`, `${domain}/annuaire*`, `${domain}/a-propos*`,
    ];
    const out = [];
    for (const p of patterns) {
        const snaps = await waybackListSnapshots(p, 3);
        for (const s of snaps.slice(0, 2)) {
            if (out.length >= maxPages) break;
            const text = await waybackFetch(s.archiveUrl);
            if (text && text.length > 200) {
                out.push({ url: s.archiveUrl, text, timestamp: s.timestamp, originalUrl: s.original });
            }
        }
        if (out.length >= maxPages) break;
    }
    return out;
}

module.exports = { waybackListSnapshots, waybackFetch, waybackContactPages };
