// ================================================================
// DNC — Do Not Contact list (SQLite)
// Permet de marquer emails/domaines à exclure de tous les futurs scans.
// ================================================================
const path = require('path');
const { log } = require('./helpers');

let db = null;

function initDnc() {
    try {
        const Database = require('better-sqlite3');
        const dbPath = path.join(__dirname, '..', 'cache.db');
        db = new Database(dbPath);
        db.exec(`
            CREATE TABLE IF NOT EXISTS dnc (
                value TEXT PRIMARY KEY,
                type TEXT NOT NULL,
                reason TEXT,
                added_at INTEGER NOT NULL
            );
        `);
        log('DNC initialisé');
    } catch (e) { log(`DNC init error: ${e.message}`); }
}

function addDnc(value, type = 'email', reason = '') {
    if (!db || !value) return false;
    try {
        db.prepare('INSERT OR REPLACE INTO dnc (value, type, reason, added_at) VALUES (?, ?, ?, ?)')
            .run(value.toLowerCase().trim(), type, reason, Date.now());
        return true;
    } catch (e) { log(`DNC add error: ${e.message}`); return false; }
}

function removeDnc(value) {
    if (!db || !value) return false;
    try {
        const info = db.prepare('DELETE FROM dnc WHERE value = ?').run(value.toLowerCase().trim());
        return info.changes > 0;
    } catch (e) { return false; }
}

function isDnc(value) {
    if (!db || !value) return false;
    try {
        // Check exact email
        const row = db.prepare('SELECT * FROM dnc WHERE value = ?').get(value.toLowerCase().trim());
        if (row) return { reason: row.reason, type: row.type };
        // Check domain match : si email xxx@domain.com, check domain seul
        if (value.includes('@')) {
            const domain = value.split('@')[1].toLowerCase();
            const domRow = db.prepare("SELECT * FROM dnc WHERE value = ? AND type = 'domain'").get(domain);
            if (domRow) return { reason: domRow.reason, type: 'domain' };
        }
        return false;
    } catch (e) { return false; }
}

function listDnc(type) {
    if (!db) return [];
    try {
        const rows = type
            ? db.prepare('SELECT * FROM dnc WHERE type = ? ORDER BY added_at DESC').all(type)
            : db.prepare('SELECT * FROM dnc ORDER BY added_at DESC').all();
        return rows;
    } catch (e) { return []; }
}

// Filtre une liste de candidats : retire ceux qui sont en DNC
function filterDnc(candidates) {
    return candidates.filter(c => {
        const hit = isDnc(c.value);
        if (hit) {
            c.eliminated = true;
            c.eliminatedReason = `DNC (${hit.type}: ${hit.reason || 'sans raison'})`;
            return true; // keep for display but eliminated
        }
        return true;
    });
}

module.exports = { initDnc, addDnc, removeDnc, isDnc, listDnc, filterDnc };
