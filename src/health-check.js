// ================================================================
// HEALTH CHECK v6 — Vérification APIs au démarrage + /api/health
// ================================================================
const { KEYS, TIMEOUTS } = require('./config');
const { fetchWithTimeout, log } = require('./helpers');
const { snovGetToken } = require('./providers/snov');
const { checkMX } = require('./providers/dns');
const { checkGravatar } = require('./providers/gravatar');

async function runHealthCheck() {
    const results = [];

    // Jina
    const jina = { name: 'Jina AI', key: !!KEYS.jina, status: null, quota: null };
    if (KEYS.jina) {
        try {
            const r = await fetchWithTimeout('https://s.jina.ai/', {
                method: 'POST',
                headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${KEYS.jina}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ q: 'test', num: 1 }),
            }, 10000);
            jina.status = r.ok ? 'OK' : `${r.status}`;
        } catch (e) { jina.status = `ERR: ${e.message.substring(0, 30)}`; }
    }
    results.push(jina);

    // Hunter
    const hunter = { name: 'Hunter.io', key: !!KEYS.hunter, status: null, quota: null };
    if (KEYS.hunter) {
        try {
            const r = await fetchWithTimeout(`https://api.hunter.io/v2/account?api_key=${KEYS.hunter}`, {}, TIMEOUTS.HUNTER);
            const data = await r.json();
            if (data.data?.requests) {
                hunter.status = 'OK';
                const s = data.data.requests.searches, v = data.data.requests.verifications;
                hunter.quota = `${s.available - s.used}/${s.available} search, ${v.available - v.used}/${v.available} verif`;
            } else hunter.status = `${r.status}`;
        } catch (e) { hunter.status = `ERR: ${e.message.substring(0, 30)}`; }
    }
    results.push(hunter);

    // Snov
    const snov = { name: 'Snov.io', key: !!(KEYS.snovId && KEYS.snovSecret), status: null, quota: null };
    if (KEYS.snovId && KEYS.snovSecret) {
        try {
            const token = await snovGetToken();
            snov.status = token ? 'OK' : 'Auth failed';
        } catch (e) { snov.status = `ERR: ${e.message.substring(0, 30)}`; }
    }
    results.push(snov);

    // Apollo
    const apollo = { name: 'Apollo.io', key: !!KEYS.apollo, status: null, quota: null };
    if (KEYS.apollo) {
        try {
            const r = await fetchWithTimeout('https://api.apollo.io/api/v1/people/match', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-api-key': KEYS.apollo },
                body: JSON.stringify({ first_name: 'Test', last_name: 'User', domain: 'example.com' }),
            }, TIMEOUTS.APOLLO);
            apollo.status = (r.status === 200 || r.status === 422) ? 'OK' : `${r.status}`;
        } catch (e) { apollo.status = `ERR: ${e.message.substring(0, 30)}`; }
    }
    results.push(apollo);

    // Pappers
    const pappers = { name: 'Pappers.fr', key: !!KEYS.pappers, status: null, quota: null };
    if (KEYS.pappers) {
        try {
            const r = await fetchWithTimeout(`https://api.pappers.fr/v2/suivi-jetons?api_token=${KEYS.pappers}`, {}, TIMEOUTS.PAPPERS);
            const data = await r.json();
            if (data.jetons_restants !== undefined) {
                pappers.status = 'OK';
                pappers.quota = `${data.jetons_restants} jetons`;
            } else pappers.status = r.ok ? 'OK' : `${r.status}`;
        } catch (e) { pappers.status = `ERR: ${e.message.substring(0, 30)}`; }
    }
    results.push(pappers);

    // Abstract
    const abstract = { name: 'Abstract', key: !!KEYS.abstract, status: null, quota: null };
    if (KEYS.abstract) {
        try {
            const r = await fetchWithTimeout(
                `https://emailvalidation.abstractapi.com/v1/?api_key=${encodeURIComponent(KEYS.abstract)}&email=test@test.com`,
                {}, TIMEOUTS.ABSTRACT
            );
            if (r.status === 401) { abstract.status = '401'; abstract.quota = 'Mauvaise clé (Email VALIDATION, pas Reputation)'; }
            else abstract.status = r.ok ? 'OK' : `${r.status}`;
        } catch (e) { abstract.status = `ERR: ${e.message.substring(0, 30)}`; }
    }
    results.push(abstract);

    // v6: GitHub
    const gh = { name: 'GitHub', key: KEYS.github ? 'auth' : 'public', status: null, quota: KEYS.github ? '5000/h' : '60/h' };
    try {
        const headers = { 'Accept': 'application/vnd.github+json', 'User-Agent': 'osint-contact-finder' };
        if (KEYS.github) headers.Authorization = `Bearer ${KEYS.github}`;
        const r = await fetchWithTimeout('https://api.github.com/rate_limit', { headers }, TIMEOUTS.GITHUB);
        if (r.ok) {
            const d = await r.json();
            gh.status = 'OK';
            const core = d.resources?.core;
            if (core) gh.quota = `${core.remaining}/${core.limit}`;
        } else gh.status = `${r.status}`;
    } catch (e) { gh.status = `ERR: ${e.message.substring(0, 30)}`; }
    results.push(gh);

    // v6: Serper
    const serper = { name: 'Serper.dev', key: !!KEYS.serper, status: null, quota: null };
    if (KEYS.serper) {
        try {
            const r = await fetchWithTimeout('https://google.serper.dev/search', {
                method: 'POST',
                headers: { 'X-API-KEY': KEYS.serper, 'Content-Type': 'application/json' },
                body: JSON.stringify({ q: 'test', num: 1 }),
            }, TIMEOUTS.SERPER);
            serper.status = r.ok ? 'OK' : `${r.status}`;
        } catch (e) { serper.status = `ERR: ${e.message.substring(0, 30)}`; }
    }
    results.push(serper);

    // v6: Tavily
    const tavily = { name: 'Tavily', key: !!KEYS.tavily, status: null, quota: null };
    if (KEYS.tavily) {
        try {
            const r = await fetchWithTimeout('https://api.tavily.com/search', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ api_key: KEYS.tavily, query: 'test', max_results: 1 }),
            }, TIMEOUTS.TAVILY);
            tavily.status = r.ok ? 'OK' : `${r.status}`;
        } catch (e) { tavily.status = `ERR: ${e.message.substring(0, 30)}`; }
    }
    results.push(tavily);

    // v6: EmailRep (public)
    const emailrep = { name: 'EmailRep', key: KEYS.emailrep ? 'auth' : 'public', status: null, quota: KEYS.emailrep ? '1000/j' : '100/j' };
    try {
        const h = { Accept: 'application/json', 'User-Agent': 'osint-contact-finder' };
        if (KEYS.emailrep) h.Key = KEYS.emailrep;
        const r = await fetchWithTimeout('https://emailrep.io/test@example.com', { headers: h }, TIMEOUTS.EMAILREP);
        emailrep.status = r.ok ? 'OK' : `${r.status}`;
    } catch (e) { emailrep.status = `ERR: ${e.message.substring(0, 30)}`; }
    results.push(emailrep);

    // v6: SecurityTrails
    const st = { name: 'SecurityTrails', key: !!KEYS.securitytrails, status: null, quota: null };
    if (KEYS.securitytrails) {
        try {
            const r = await fetchWithTimeout('https://api.securitytrails.com/v1/ping', {
                headers: { 'APIKEY': KEYS.securitytrails },
            }, TIMEOUTS.SECURITYTRAILS);
            st.status = r.ok ? 'OK' : `${r.status}`;
        } catch (e) { st.status = `ERR: ${e.message.substring(0, 30)}`; }
    }
    results.push(st);

    // DNS Google
    const dns = { name: 'DNS Google', key: 'n/a', status: null, quota: 'Illimité' };
    try {
        const mx = await checkMX('google.com');
        dns.status = mx.valid ? 'OK' : 'KO';
    } catch (e) { dns.status = `ERR: ${e.message.substring(0, 30)}`; }
    results.push(dns);

    // Gravatar
    const gravatar = { name: 'Gravatar', key: 'n/a', status: null, quota: 'Illimité' };
    try { await checkGravatar('test@test.com'); gravatar.status = 'OK'; }
    catch (e) { gravatar.status = `ERR: ${e.message.substring(0, 30)}`; }
    results.push(gravatar);

    return results;
}

function printHealthTable(results) {
    const line = '='.repeat(75);
    console.log(`\n${line}`);
    console.log('  OSINT Contact Finder v6.0 — Health Check');
    console.log(line);
    console.log('  API              | Clé     | Status     | Quota');
    console.log('  ' + '-'.repeat(71));
    for (const r of results) {
        const key = r.key === true ? 'OK' : r.key === 'n/a' ? 'n/a' : typeof r.key === 'string' ? r.key : '--';
        const status = r.status === 'OK' ? 'OK   ' : r.status ? r.status.substring(0, 8).padEnd(8) : '--   ';
        const quota = r.quota || '--';
        const name = r.name.padEnd(16);
        console.log(`  ${name} | ${key.padEnd(7)} | ${status.padEnd(10)} | ${quota}`);
    }
    console.log(line + '\n');
}

module.exports = { runHealthCheck, printHealthTable };
