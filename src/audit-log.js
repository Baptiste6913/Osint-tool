// ================================================================
// AUDIT LOG — Journal RGPD des scans
// Conservé 3 ans max (art. 6(1)(f) intérêt légitime)
// ================================================================
const path = require('path');
const { log } = require('./helpers');

let db = null;
const RETENTION_DAYS = parseInt(process.env.AUDIT_RETENTION_DAYS) || (365 * 3);

function initAuditLog() {
    try {
        const Database = require('better-sqlite3');
        const dbPath = path.join(__dirname, '..', 'cache.db');
        db = new Database(dbPath);
        db.exec(`
            CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp INTEGER NOT NULL,
                ip TEXT,
                fullname TEXT,
                company TEXT,
                purpose TEXT,
                sources_used TEXT,
                results_count INTEGER,
                elapsed_sec REAL
            );
            CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
            CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_log(fullname, company);
        `);
        // Auto-cleanup (retention)
        const cutoff = Date.now() - (RETENTION_DAYS * 86400 * 1000);
        const info = db.prepare('DELETE FROM audit_log WHERE timestamp < ?').run(cutoff);
        if (info.changes > 0) log(`Audit log : ${info.changes} entrée(s) expirée(s) purgée(s)`);
        log(`Audit log initialisé (retention: ${RETENTION_DAYS}j)`);
    } catch (e) { log(`Audit log init error: ${e.message}`); }
}

function logScan({ ip, fullname, company, purpose, sourcesUsed, resultsCount, elapsedSec }) {
    if (!db) return;
    try {
        db.prepare(`INSERT INTO audit_log (timestamp, ip, fullname, company, purpose, sources_used, results_count, elapsed_sec)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(Date.now(), ip || '', fullname || '', company || '', purpose || '',
                 JSON.stringify(sourcesUsed || []), resultsCount || 0, elapsedSec || 0);
    } catch (e) { log(`Audit log error: ${e.message}`); }
}

function queryAuditLog({ fullname, company, since, limit = 100 } = {}) {
    if (!db) return [];
    try {
        let sql = 'SELECT * FROM audit_log WHERE 1=1';
        const params = [];
        if (fullname) { sql += ' AND fullname = ?'; params.push(fullname); }
        if (company) { sql += ' AND company = ?'; params.push(company); }
        if (since) { sql += ' AND timestamp > ?'; params.push(since); }
        sql += ' ORDER BY timestamp DESC LIMIT ?';
        params.push(limit);
        return db.prepare(sql).all(...params);
    } catch (e) { return []; }
}

// Pour RGPD "droit d'accès" : retourner toutes les recherches sur une personne
function rightOfAccess(fullname, company) {
    return queryAuditLog({ fullname, company, limit: 10000 });
}

// Pour RGPD "droit d'effacement" : purger toutes les entrées sur une personne
function rightToErasure(fullname) {
    if (!db) return 0;
    try {
        const info = db.prepare('DELETE FROM audit_log WHERE fullname = ?').run(fullname);
        return info.changes;
    } catch (e) { return 0; }
}

module.exports = { initAuditLog, logScan, queryAuditLog, rightOfAccess, rightToErasure };
