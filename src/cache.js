// ================================================================
// CACHE — SQLite, deux namespaces :
// 1) scan_cache : résultats complets (nom+entreprise) TTL 24h
// 2) domain_cache : métadonnées par domaine (mx, catchAll, pattern, company→domain) TTL 7j
// ================================================================
const crypto = require('crypto');
const path = require('path');
const { log } = require('./helpers');

let db = null;
const CACHE_TTL_HOURS = parseInt(process.env.CACHE_TTL_HOURS) || 24;
const DOMAIN_TTL_HOURS = parseInt(process.env.DOMAIN_CACHE_TTL_HOURS) || (24 * 7);

function initCache() {
    try {
        const Database = require('better-sqlite3');
        const dbPath = path.join(__dirname, '..', 'cache.db');
        db = new Database(dbPath);
        db.exec(`
            CREATE TABLE IF NOT EXISTS scan_cache (
                key TEXT PRIMARY KEY,
                data TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS domain_cache (
                domain TEXT PRIMARY KEY,
                data TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );
        `);
        // Cleanup expired
        const scanExpiry = Date.now() - (CACHE_TTL_HOURS * 3600 * 1000);
        db.prepare('DELETE FROM scan_cache WHERE created_at < ?').run(scanExpiry);
        const domExpiry = Date.now() - (DOMAIN_TTL_HOURS * 3600 * 1000);
        db.prepare('DELETE FROM domain_cache WHERE updated_at < ?').run(domExpiry);
        log(`Cache SQLite initialisé (scan TTL: ${CACHE_TTL_HOURS}h, domain TTL: ${DOMAIN_TTL_HOURS}h)`);
    } catch (e) {
        log(`Cache SQLite non disponible: ${e.message} — cache désactivé`);
        db = null;
    }
}

function cacheKey(fullname, company) {
    return crypto.createHash('sha256').update(`${fullname.toLowerCase().trim()}|${company.toLowerCase().trim()}`).digest('hex');
}

// ---------- scan_cache ----------
function getFromCache(fullname, company) {
    if (!db) return null;
    try {
        const key = cacheKey(fullname, company);
        const expiry = Date.now() - (CACHE_TTL_HOURS * 3600 * 1000);
        const row = db.prepare('SELECT data, created_at FROM scan_cache WHERE key = ? AND created_at > ?').get(key, expiry);
        if (row) {
            log(`Cache HIT pour ${fullname} @ ${company}`);
            return JSON.parse(row.data);
        }
    } catch (e) { log(`Cache read error: ${e.message}`); }
    return null;
}

function setInCache(fullname, company, data) {
    if (!db) return;
    try {
        const key = cacheKey(fullname, company);
        db.prepare('INSERT OR REPLACE INTO scan_cache (key, data, created_at) VALUES (?, ?, ?)').run(key, JSON.stringify(data), Date.now());
    } catch (e) { log(`Cache write error: ${e.message}`); }
}

function clearCache() {
    if (!db) return 0;
    try {
        const info = db.prepare('DELETE FROM scan_cache').run();
        log(`Cache vidé : ${info.changes} entrée(s)`);
        return info.changes;
    } catch (e) { log(`Cache clear error: ${e.message}`); return 0; }
}

function cacheStats() {
    if (!db) return { enabled: false, entries: 0 };
    try {
        const scanCount = db.prepare('SELECT COUNT(*) as cnt FROM scan_cache').get().cnt;
        const domCount = db.prepare('SELECT COUNT(*) as cnt FROM domain_cache').get().cnt;
        return {
            enabled: true,
            scanEntries: scanCount,
            domainEntries: domCount,
            scanTtlHours: CACHE_TTL_HOURS,
            domainTtlHours: DOMAIN_TTL_HOURS,
        };
    } catch (e) { return { enabled: false }; }
}

// ---------- domain_cache ----------
// Stocke métadonnées par domaine : { mx, catchAll, hunterPattern, hunterEmails, domain (pour company→domain), ... }
function getDomainCache(domain) {
    if (!db || !domain) return null;
    try {
        const expiry = Date.now() - (DOMAIN_TTL_HOURS * 3600 * 1000);
        const row = db.prepare('SELECT data, updated_at FROM domain_cache WHERE domain = ? AND updated_at > ?').get(domain.toLowerCase(), expiry);
        if (row) return JSON.parse(row.data);
    } catch (e) { log(`Domain cache read error: ${e.message}`); }
    return null;
}

function setDomainCache(domain, data) {
    if (!db || !domain) return;
    try {
        // Merge avec existant
        const existing = getDomainCache(domain) || {};
        const merged = { ...existing, ...data };
        db.prepare('INSERT OR REPLACE INTO domain_cache (domain, data, updated_at) VALUES (?, ?, ?)').run(domain.toLowerCase(), JSON.stringify(merged), Date.now());
    } catch (e) { log(`Domain cache write error: ${e.message}`); }
}

function clearDomainCache() {
    if (!db) return 0;
    try {
        const info = db.prepare('DELETE FROM domain_cache').run();
        log(`Domain cache vidé : ${info.changes} entrée(s)`);
        return info.changes;
    } catch (e) { return 0; }
}

module.exports = {
    initCache,
    getFromCache, setInCache, clearCache, cacheStats,
    getDomainCache, setDomainCache, clearDomainCache,
};
