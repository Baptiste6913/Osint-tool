// ================================================================
// OSINT Contact Finder v5.0 — Backend Server
// Refactored: modules, cache, rate-limit, health-check, agents Ruflo
// ================================================================
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const { KEYS } = require('./src/config');
const { log } = require('./src/helpers');
const { scanRoute, statusRoute } = require('./src/pipeline');
const { rateLimitMiddleware } = require('./src/rate-limiter');
const { initCache, getFromCache, setInCache, clearCache, cacheStats } = require('./src/cache');
const { runHealthCheck, printHealthTable } = require('./src/health-check');
const { sseLog, sseDone } = require('./src/sse');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

// ================================================================
// ROUTES
// ================================================================

// Status + health-check
app.get('/api/status', statusRoute);

app.get('/api/health', async (req, res) => {
    const results = await runHealthCheck();
    res.json({ results });
});

// Full scan (avec cache + rate limit)
app.post('/api/scan', rateLimitMiddleware, async (req, res) => {
    const { fullname, company } = req.body;

    // Check cache
    if (fullname && company) {
        const cached = getFromCache(fullname, company);
        if (cached) {
            res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
            sseLog(res, 'Resultat en cache (< 24h)', 'success');
            sseDone(res, { ...cached, cached: true });
            return;
        }
    }

    // Intercept sseDone to cache results
    const originalEnd = res.end.bind(res);
    let lastPayload = null;
    const originalWrite = res.write.bind(res);
    res.write = function(chunk, ...args) {
        const str = typeof chunk === 'string' ? chunk : chunk.toString();
        if (str.includes('"event":"done"')) {
            try {
                const jsonStr = str.replace(/^data: /, '').trim();
                const parsed = JSON.parse(jsonStr);
                if (!parsed.error) lastPayload = parsed;
            } catch (e) { /* not parseable, skip */ }
        }
        return originalWrite(chunk, ...args);
    };
    res.end = function(...args) {
        if (lastPayload && fullname && company) {
            setInCache(fullname, company, lastPayload);
        }
        return originalEnd(...args);
    };

    return scanRoute(req, res);
});

// Quick scan (skip Jina web scraping)
app.post('/api/scan/quick', rateLimitMiddleware, (req, res) => {
    req.body._quickMode = true;
    return scanRoute(req, res);
});

// Batch scan
app.post('/api/scan/batch', rateLimitMiddleware, async (req, res) => {
    const { contacts } = req.body;
    if (!Array.isArray(contacts) || contacts.length === 0) {
        return res.status(400).json({ error: 'contacts array requis' });
    }
    if (contacts.length > 10) {
        return res.status(400).json({ error: 'Max 10 contacts par batch' });
    }

    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });

    const results = [];
    for (let i = 0; i < contacts.length; i++) {
        const { fullname, company } = contacts[i];
        if (!fullname || !company) {
            results.push({ fullname, company, error: 'fullname et company requis' });
            continue;
        }

        sseLog(res, `Batch ${i + 1}/${contacts.length} : ${fullname} @ ${company}`, 'info');

        // Collect SSE done payload
        const collected = await new Promise(resolve => {
            const fakeRes = {
                write(chunk) {
                    res.write(chunk); // Forward SSE to client
                },
                end() { /* don't end the real response */ },
                writeHead() {},
            };

            // Intercept done event
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

            const fakeReq = { body: { fullname, company } };
            scanRoute(fakeReq, fakeRes).catch(e => resolve({ error: e.message }));
        });

        results.push({ fullname, company, ...collected });

        if (i < contacts.length - 1) {
            await new Promise(r => setTimeout(r, 2000));
        }
    }

    sseDone(res, { batch: true, total: contacts.length, results });
});

// Export
app.get('/api/export/:format', (req, res) => {
    const { format } = req.params;
    const { data } = req.query;
    if (!data) return res.status(400).json({ error: 'data parameter requis (base64)' });

    try {
        const decoded = JSON.parse(Buffer.from(data, 'base64').toString('utf-8'));

        if (format === 'json') {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', 'attachment; filename="osint-results.json"');
            return res.json(decoded);
        }

        if (format === 'csv') {
            const allContacts = [
                ...(decoded.verified || []),
                ...(decoded.probable || []),
                ...(decoded.possible || []),
            ];
            const lines = ['type,value,score,sources,proofs'];
            for (const c of allContacts) {
                const sources = (c.sources || []).join('; ').replace(/,/g, ';');
                const proofs = (c.proofs || []).join('; ').replace(/,/g, ';');
                lines.push(`${c.type},${c.value},${c.score},"${sources}","${proofs}"`);
            }
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="osint-results.csv"');
            return res.send(lines.join('\n'));
        }

        res.status(400).json({ error: 'Format non supporte. Utilisez json ou csv.' });
    } catch (e) {
        res.status(400).json({ error: `Decodage echoue: ${e.message}` });
    }
});

// Cache management
app.get('/api/cache/clear', (req, res) => {
    const count = clearCache();
    res.json({ cleared: count });
});

app.get('/api/cache/stats', (req, res) => {
    res.json(cacheStats());
});

// SPA fallback
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ================================================================
// STARTUP
// ================================================================
initCache();

app.listen(PORT, '0.0.0.0', async () => {
    log(`=== OSINT Contact Finder v5.0 ===`);
    log(`http://localhost:${PORT}`);

    // Health check au demarrage
    try {
        const results = await runHealthCheck();
        printHealthTable(results);
    } catch (e) {
        log(`Health check error: ${e.message}`);
        // Fallback simple
        log(`APIs :`);
        log(`  Jina    ${KEYS.jina ? 'OK' : 'MANQUANT (REQUIS)'}`);
        log(`  Hunter  ${KEYS.hunter ? 'OK' : '--'}`);
        log(`  Snov    ${KEYS.snovId && KEYS.snovSecret ? 'OK' : '--'}`);
        log(`  Apollo  ${KEYS.apollo ? 'OK' : '--'}`);
        log(`  Pappers ${KEYS.pappers ? 'OK' : '--'}`);
        log(`  Abstract ${KEYS.abstract ? 'OK' : '--'}`);
    }

    if (!KEYS.jina) log(`JINA_API_KEY manquante !`);
});
