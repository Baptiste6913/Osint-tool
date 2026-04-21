// ================================================================
// RATE LIMITER — Limitation par IP (en memoire, pas de dependance)
// ================================================================

const LIMITS = {
    MINUTE: { max: 5, windowMs: 60 * 1000 },
    HOUR: { max: 50, windowMs: 60 * 60 * 1000 },
};

const ipRecords = new Map();

// Cleanup toutes les 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [ip, records] of ipRecords) {
        const filtered = records.filter(ts => now - ts < LIMITS.HOUR.windowMs);
        if (filtered.length === 0) ipRecords.delete(ip);
        else ipRecords.set(ip, filtered);
    }
}, 5 * 60 * 1000);

function rateLimitMiddleware(req, res, next) {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const now = Date.now();

    if (!ipRecords.has(ip)) ipRecords.set(ip, []);
    const records = ipRecords.get(ip);

    // Check minute limit
    const lastMinute = records.filter(ts => now - ts < LIMITS.MINUTE.windowMs);
    if (lastMinute.length >= LIMITS.MINUTE.max) {
        const retryAfter = Math.ceil((LIMITS.MINUTE.windowMs - (now - lastMinute[0])) / 1000);
        res.set('Retry-After', String(retryAfter));
        return res.status(429).json({
            error: `Rate limit: max ${LIMITS.MINUTE.max} scans/minute. Retry in ${retryAfter}s.`,
        });
    }

    // Check hour limit
    const lastHour = records.filter(ts => now - ts < LIMITS.HOUR.windowMs);
    if (lastHour.length >= LIMITS.HOUR.max) {
        const retryAfter = Math.ceil((LIMITS.HOUR.windowMs - (now - lastHour[0])) / 1000);
        res.set('Retry-After', String(retryAfter));
        return res.status(429).json({
            error: `Rate limit: max ${LIMITS.HOUR.max} scans/heure. Retry in ${retryAfter}s.`,
        });
    }

    records.push(now);
    next();
}

module.exports = { rateLimitMiddleware };
