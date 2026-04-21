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
    return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function parseName(fullname) {
    const clean = normalize(fullname);
    const parts = clean.split(/\s+/);
    const first = parts[0] || '';
    const last = parts.slice(1).join('') || '';
    const firstInitial = first.charAt(0);
    const og = fullname.split(/\s+/);
    return { first, last, firstInitial, firstOg: og[0], lastOg: og.slice(1).join(' '), fullClean: clean, fullOg: fullname };
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

function isQuotaError(status, body) {
    if (status === 402 || status === 429) return true;
    if (status === 403 && typeof body === 'string' && /quota|limit|credit|exceeded|rate_limit/i.test(body)) return true;
    return false;
}

module.exports = {
    ts, log, sleep, normalize, parseName, extractDomain,
    shouldReadUrl, fetchWithTimeout, isQuotaError,
};
