// ================================================================
// OSINT Contact Finder v6.0 — Backend Server
// v6 additions : GitHub/Serper/Tavily/Wayback/EmailRep/RDAP/SecurityTrails
//                SMTP direct, MX fingerprint, pattern stats, DNC, audit log,
//                CRM exports (HubSpot/Salesforce/Pipedrive)
// ================================================================
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const { KEYS } = require('./src/config');
const { log } = require('./src/helpers');
const { scanRoute, statusRoute } = require('./src/pipeline');
const { rateLimitMiddleware } = require('./src/rate-limiter');
const { initCache, getFromCache, setInCache, clearCache, clearDomainCache, cacheStats } = require('./src/cache');
const { initDnc, addDnc, removeDnc, listDnc, isDnc } = require('./src/dnc');
const { initAuditLog, logScan, queryAuditLog, rightOfAccess, rightToErasure } = require('./src/audit-log');
const { runHealthCheck, printHealthTable } = require('./src/health-check');
const { sseLog, sseDone } = require('./src/sse');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

// ================================================================
// STATUS / HEALTH
// ================================================================
app.get('/api/status', statusRoute);

app.get('/api/health', async (req, res) => {
    const results = await runHealthCheck();
    res.json({ results });
});

// ================================================================
// SCAN (full / quick / batch)
// ================================================================
function wrapSseScan(req, res) {
    // Intercept sseDone pour cache + audit log
    const originalEnd = res.end.bind(res);
    const originalWrite = res.write.bind(res);
    let lastPayload = null;
    const scanStart = Date.now();

    res.write = function(chunk, ...args) {
        const str = typeof chunk === 'string' ? chunk : chunk.toString();
        if (str.includes('"event":"done"')) {
            try {
                const jsonStr = str.replace(/^data: /, '').trim();
                const parsed = JSON.parse(jsonStr);
                if (!parsed.error) lastPayload = parsed;
            } catch (e) { /* skip */ }
        }
        return originalWrite(chunk, ...args);
    };
    res.end = function(...args) {
        if (lastPayload && req.body.fullname && req.body.company) {
            setInCache(req.body.fullname, req.body.company, lastPayload);
            // Audit log
            const total = (lastPayload.summary?.verified || 0) + (lastPayload.summary?.probable || 0) + (lastPayload.summary?.possible || 0);
            logScan({
                ip: req.ip || req.connection?.remoteAddress,
                fullname: req.body.fullname,
                company: req.body.company,
                purpose: req.body.purpose || 'prospection',
                sourcesUsed: lastPayload.sources?.map(s => s.query) || [],
                resultsCount: total,
                elapsedSec: (Date.now() - scanStart) / 1000,
            });
        }
        return originalEnd(...args);
    };
}

app.post('/api/scan', rateLimitMiddleware, async (req, res) => {
    const { fullname, company } = req.body;

    if (fullname && company) {
        const cached = getFromCache(fullname, company);
        if (cached) {
            res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
            sseLog(res, 'Résultat en cache (< 24h)', 'success');
            sseDone(res, { ...cached, cached: true });
            return;
        }
    }

    wrapSseScan(req, res);
    return scanRoute(req, res);
});

app.post('/api/scan/quick', rateLimitMiddleware, (req, res) => {
    req.body._quickMode = true;
    wrapSseScan(req, res);
    return scanRoute(req, res);
});

app.post('/api/scan/batch', rateLimitMiddleware, async (req, res) => {
    const { contacts } = req.body;
    if (!Array.isArray(contacts) || contacts.length === 0) {
        return res.status(400).json({ error: 'contacts array requis' });
    }
    if (contacts.length > 25) {
        return res.status(400).json({ error: 'Max 25 contacts par batch' });
    }

    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });

    const results = [];
    const scanStart = Date.now();
    for (let i = 0; i < contacts.length; i++) {
        const { fullname, company } = contacts[i];
        if (!fullname || !company) { results.push({ fullname, company, error: 'fullname et company requis' }); continue; }

        sseLog(res, `Batch ${i + 1}/${contacts.length} : ${fullname} @ ${company}`, 'info');

        // Cache check
        const cached = getFromCache(fullname, company);
        if (cached) {
            results.push({ fullname, company, ...cached, cached: true });
            sseLog(res, `Cache hit (${fullname})`, 'success');
            continue;
        }

        const collected = await new Promise(resolve => {
            const fakeRes = {
                write(chunk) { res.write(chunk); },
                end() {},
                writeHead() {},
            };
            const origWrite = fakeRes.write;
            fakeRes.write = function(chunk) {
                const str = typeof chunk === 'string' ? chunk : chunk.toString();
                if (str.includes('"event":"done"')) {
                    try {
                        const jsonStr = str.replace(/^data: /, '').trim();
                        resolve(JSON.parse(jsonStr));
                    } catch (e) { resolve({ error: 'parse error' }); }
                    return;
                }
                origWrite.call(fakeRes, chunk);
            };

            const fakeReq = { body: { fullname, company }, ip: req.ip };
            scanRoute(fakeReq, fakeRes).catch(e => resolve({ error: e.message }));
        });

        results.push({ fullname, company, ...collected });
        if (!collected.error) {
            setInCache(fullname, company, collected);
            logScan({ ip: req.ip, fullname, company, purpose: 'batch', resultsCount: collected.summary?.verified || 0 });
        }
        if (i < contacts.length - 1) await new Promise(r => setTimeout(r, 1500));
    }

    sseDone(res, { batch: true, total: contacts.length, results, elapsedSec: (Date.now() - scanStart) / 1000 });
});

// ================================================================
// EXPORTS (JSON, CSV, HubSpot, Salesforce, Pipedrive)
// ================================================================
function flattenContacts(decoded) {
    return [
        ...(decoded.verified || []).map(c => ({ ...c, tier: 'verified' })),
        ...(decoded.probable || []).map(c => ({ ...c, tier: 'probable' })),
        ...(decoded.possible || []).map(c => ({ ...c, tier: 'possible' })),
    ];
}

function csvEscape(v) {
    if (v === null || v === undefined) return '';
    const s = String(v).replace(/"/g, '""');
    return /[,"\n]/.test(s) ? `"${s}"` : s;
}

app.get('/api/export/:format', (req, res) => {
    const { format } = req.params;
    const { data } = req.query;
    if (!data) return res.status(400).json({ error: 'data parameter requis (base64)' });

    try {
        const decoded = JSON.parse(Buffer.from(data, 'base64').toString('utf-8'));
        const all = flattenContacts(decoded);

        if (format === 'json') {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', 'attachment; filename="osint-results.json"');
            return res.json(decoded);
        }

        if (format === 'csv') {
            const lines = ['type,value,score,tier,sources,proofs'];
            for (const c of all) {
                lines.push([c.type, c.value, c.score, c.tier,
                    (c.sources || []).join('; '),
                    (c.proofs || []).join('; ')
                ].map(csvEscape).join(','));
            }
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="osint-results.csv"');
            return res.send(lines.join('\n'));
        }

        if (format === 'hubspot') {
            // HubSpot Contact CSV : Email, First Name, Last Name, Job Title, Phone, LinkedIn
            const lines = ['Email,First Name,Last Name,Job Title,Phone,LinkedIn URL,Lead Score,Source'];
            for (const c of all) {
                if (c.type !== 'email') continue;
                const phone = all.find(x => x.type === 'phone')?.value || '';
                const li = all.find(x => x.type === 'linkedin')?.value || '';
                // Infer first/last from fullname context if possible — else blank
                lines.push([c.value, '', '', c.apolloTitle || '', phone, li, c.score,
                    (c.sources || []).join('; ')
                ].map(csvEscape).join(','));
            }
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="hubspot-import.csv"');
            return res.send(lines.join('\n'));
        }

        if (format === 'salesforce') {
            // Salesforce Lead CSV
            const lines = ['Email,FirstName,LastName,Title,Phone,LeadSource,Rating'];
            for (const c of all) {
                if (c.type !== 'email') continue;
                const phone = all.find(x => x.type === 'phone')?.value || '';
                const rating = c.score >= 90 ? 'Hot' : c.score >= 60 ? 'Warm' : 'Cold';
                lines.push([c.value, '', '', c.apolloTitle || '', phone, 'OSINT', rating].map(csvEscape).join(','));
            }
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="salesforce-leads.csv"');
            return res.send(lines.join('\n'));
        }

        if (format === 'pipedrive') {
            const lines = ['Email,Name,Organization,Phone,Title,Owner Notes'];
            for (const c of all) {
                if (c.type !== 'email') continue;
                const phone = all.find(x => x.type === 'phone')?.value || '';
                lines.push([c.value, '', '', phone, c.apolloTitle || '',
                    `Score ${c.score} - ${(c.proofs || []).join('; ')}`
                ].map(csvEscape).join(','));
            }
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="pipedrive-contacts.csv"');
            return res.send(lines.join('\n'));
        }

        res.status(400).json({ error: 'Format non supporté : json, csv, hubspot, salesforce, pipedrive' });
    } catch (e) {
        res.status(400).json({ error: `Décodage échoué : ${e.message}` });
    }
});

// ================================================================
// DNC (Do Not Contact)
// ================================================================
app.get('/api/dnc', (req, res) => {
    const { type } = req.query;
    res.json({ entries: listDnc(type) });
});

app.post('/api/dnc', (req, res) => {
    const { value, type = 'email', reason = '' } = req.body;
    if (!value) return res.status(400).json({ error: 'value requis' });
    const ok = addDnc(value, type, reason);
    res.json({ ok, value, type, reason });
});

app.delete('/api/dnc/:value', (req, res) => {
    const ok = removeDnc(req.params.value);
    res.json({ ok });
});

app.get('/api/dnc/check/:value', (req, res) => {
    res.json({ dnc: isDnc(req.params.value) });
});

// ================================================================
// AUDIT LOG (RGPD)
// ================================================================
app.get('/api/audit', (req, res) => {
    const { fullname, company, since, limit } = req.query;
    const entries = queryAuditLog({ fullname, company, since: since ? parseInt(since) : undefined, limit: limit ? parseInt(limit) : 100 });
    res.json({ entries });
});

// Droit d'accès RGPD art. 15
app.get('/api/audit/access', (req, res) => {
    const { fullname, company } = req.query;
    if (!fullname) return res.status(400).json({ error: 'fullname requis' });
    res.json({ entries: rightOfAccess(fullname, company) });
});

// Droit d'effacement RGPD art. 17
app.delete('/api/audit/erasure', (req, res) => {
    const { fullname } = req.body;
    if (!fullname) return res.status(400).json({ error: 'fullname requis' });
    const deleted = rightToErasure(fullname);
    res.json({ deleted });
});

// ================================================================
// CACHE
// ================================================================
app.get('/api/cache/clear', (req, res) => {
    const scan = clearCache();
    const domain = clearDomainCache();
    res.json({ scanCleared: scan, domainCleared: domain });
});

app.get('/api/cache/stats', (req, res) => {
    res.json(cacheStats());
});

// ================================================================
// SPA fallback
// ================================================================
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ================================================================
// STARTUP
// ================================================================
initCache();
initDnc();
initAuditLog();

app.listen(PORT, '0.0.0.0', async () => {
    log(`=== OSINT Contact Finder v6.0 ===`);
    log(`http://localhost:${PORT}`);

    try {
        const results = await runHealthCheck();
        printHealthTable(results);
    } catch (e) {
        log(`Health check error: ${e.message}`);
        log(`APIs :`);
        log(`  Jina    ${KEYS.jina ? 'OK' : 'MANQUANT (REQUIS)'}`);
        log(`  Hunter  ${KEYS.hunter ? 'OK' : '--'}`);
        log(`  Snov    ${KEYS.snovId && KEYS.snovSecret ? 'OK' : '--'}`);
        log(`  Apollo  ${KEYS.apollo ? 'OK' : '--'}`);
        log(`  Pappers ${KEYS.pappers ? 'OK' : '--'}`);
        log(`  Abstract ${KEYS.abstract ? 'OK' : '--'}`);
        log(`  GitHub  ${KEYS.github ? 'OK (auth)' : 'public (60/h)'}`);
        log(`  Serper  ${KEYS.serper ? 'OK' : '--'}`);
        log(`  Tavily  ${KEYS.tavily ? 'OK' : '--'}`);
        log(`  EmailRep ${KEYS.emailrep ? 'OK' : 'public (100/j)'}`);
    }

    if (!KEYS.jina) log(`JINA_API_KEY manquante !`);
});
