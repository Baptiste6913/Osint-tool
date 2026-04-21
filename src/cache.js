// ================================================================
// CACHE — Cache SQLite pour resultats de scan (TTL 24h)
// ================================================================
const crypto = require('crypto');
const path = require('path');
const { log } = require('./helpers');

let db = null;
const CACHE_TTL_HOURS = parseInt(process.env.CACHE_TTL_HOURS) || 24;

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
            )
        `);
        // Cleanup expired entries on init
        const expiry = Date.now() - (CACHE_TTL_HOURS * 3600 * 1000);
        db.prepare('DELETE FROM scan_cache WHERE created_at < ?').run(expiry);
        log(`Cache SQLite initialise (TTL: ${CACHE_TTL_HOURS}h)`);
    } catch (e) {
        log(`Cache SQLite non disponible: ${e.message} — cache desactive`);
        db = null;
    }
}

function cacheKey(fullname, company) {
    return crypto.createHash('sha256').update(`${fullname.toLowerCase().trim()}|${company.toLowerCase().trim()}`).digest('hex');
}

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
        log(`Cache vide : ${info.changes} entree(s) supprimee(s)`);
        return info.changes;
    } catch (e) { log(`Cache clear error: ${e.message}`); return 0; }
}

function cacheStats() {
    if (!db) return { enabled: false, entries: 0 };
    try {
        const row = db.prepare('SELECT COUNT(*) as cnt FROM scan_cache').get();
        return { enabled: true, entries: row.cnt, ttlHours: CACHE_TTL_HOURS };
    } catch (e) { return { enabled: false, entries: 0 }; }
}

module.exports = { initCache, getFromCache, setInCache, clearCache, cacheStats };
