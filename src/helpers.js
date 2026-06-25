// ================================================================
// HELPERS — Fonctions utilitaires
// ================================================================
const fetch = require('node-fetch');
const { BLOCKED_READER_DOMAINS } = require('./config');

function ts() {
    return new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function log(msg) {
    console.log(`[${ts()}] ${msg}`);
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function normalize(str) {
    return str.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// ================================================================
// Parse name — gère compound ("Jean-Pierre"), particules ("van der", "de la", "d'"),
// garde la structure multi-mots (Prénom "Jean Paul" + Nom "de la Rochefoucauld").
// Retourne aussi firstParts / lastParts pour génération de patterns avancés.
// ================================================================
const PARTICLES = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'van', 'der', 'den', 'von', 'da', 'do', 'dos', 'di', 'al', 'el', 'y', "l'", "d'"]);

function parseName(fullname) {
    const clean = normalize(fullname);
    const og = fullname.trim().split(/\s+/);
    if (og.length === 0) return { first: '', last: '', firstInitial: '', firstOg: '', lastOg: '', firstParts: [], lastParts: [], fullClean: clean, fullOg: fullname };

    // 1er token = prénom (peut contenir tiret : "Jean-Pierre" → ['jean', 'pierre'])
    const firstOg = og[0];
    const lastOg = og.slice(1).join(' ');

    // Split prénom sur tiret/apostrophe pour avoir les composants
    const firstParts = firstOg.toLowerCase().split(/[-']+/).map(normalize).filter(Boolean);
    // Split nom et retirer les particules
    const lastParts = lastOg.toLowerCase().split(/[\s\-]+/).map(normalize).filter(w => w && !PARTICLES.has(w));

    // "first" = prénom compact (sans tiret, sans accent)
    const first = firstParts.join('');
    // "last" = concaténation des parts significatives (sans particules)
    const last = lastParts.join('');

    const firstInitial = (firstParts[0] || '')[0] || '';
    // Initiales multiples pour "Jean-Pierre" → "jp"
    const firstInitials = firstParts.map(p => p[0]).join('');

    return {
        first, last, firstInitial, firstInitials,
        firstOg, lastOg,
        firstParts, lastParts,
        fullClean: clean, fullOg: fullname,
    };
}

function extractDomain(company) {
    let d = company.trim().toLowerCase();
    if (d.includes('.') && !d.includes(' ')) {
        d = d.replace(/^(https?:\/\/)?(www\.)?/, '');
        return d.split('/')[0];
    }
    return d.replace(/[^a-z0-9]/g, '');
}

function shouldReadUrl(url) {
    try {
        const host = new URL(url).hostname.replace('www.', '');
        // Exception : on LIT les profils LinkedIn (pas le reste de LinkedIn)
        if (host.includes('linkedin.com')) {
            return /\/in\//i.test(url);
        }
        return !BLOCKED_READER_DOMAINS.some(d => host.includes(d));
    } catch (e) {
        log(`shouldReadUrl error for ${url}: ${e.message}`);
        return false;
    }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timeout);
        return res;
    } catch (e) {
        clearTimeout(timeout);
        if (e.name === 'AbortError') {
            throw new Error(`Timeout après ${timeoutMs / 1000}s`);
        }
        throw e;
    }
}

// Retry + backoff exponentiel pour APIs transitoires (5xx / timeout)
async function fetchWithRetry(url, options = {}, timeoutMs = 15000, retries = 2) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const res = await fetchWithTimeout(url, options, timeoutMs);
            // Retry uniquement sur 5xx, pas sur 4xx
            if (res.status >= 500 && res.status < 600 && attempt < retries) {
                await sleep(500 * Math.pow(2, attempt));
                continue;
            }
            return res;
        } catch (e) {
            lastErr = e;
            if (attempt < retries && /Timeout|ECONNRESET|ETIMEDOUT/i.test(e.message)) {
                await sleep(500 * Math.pow(2, attempt));
                continue;
            }
            throw e;
        }
    }
    throw lastErr;
}

function isQuotaError(status, body) {
    if (status === 402 || status === 429) return true;
    if (status === 403 && typeof body === 'string' && /quota|limit|credit|exceeded|rate_limit/i.test(body)) return true;
    return false;
}

module.exports = {
    ts, log, sleep, normalize, parseName, extractDomain,
    shouldReadUrl, fetchWithTimeout, fetchWithRetry, isQuotaError,
    PARTICLES,
};
