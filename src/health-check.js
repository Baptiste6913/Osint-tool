// ================================================================
// HEALTH CHECK — Verification APIs au demarrage + /api/status
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
                const s = data.data.requests.searches;
                const v = data.data.requests.verifications;
                hunter.quota = `${s.available - s.used}/${s.available} search, ${v.available - v.used}/${v.available} verif`;
            } else {
                hunter.status = `${r.status}`;
            }
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
            } else if (r.ok) {
                pappers.status = 'OK';
            } else {
                pappers.status = `${r.status}`;
            }
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
            if (r.status === 401) {
                abstract.status = '401';
                abstract.quota = 'Mauvaise cle? Verifiez Email VALIDATION (pas Reputation)';
            } else if (r.ok) {
                abstract.status = 'OK';
            } else {
                abstract.status = `${r.status}`;
            }
        } catch (e) { abstract.status = `ERR: ${e.message.substring(0, 30)}`; }
    }
    results.push(abstract);

    // DNS Google
    const dns = { name: 'DNS Google', key: 'n/a', status: null, quota: 'Illimite' };
    try {
        const mx = await checkMX('google.com');
        dns.status = mx.valid ? 'OK' : 'KO';
    } catch (e) { dns.status = `ERR: ${e.message.substring(0, 30)}`; }
    results.push(dns);

    // Gravatar
    const gravatar = { name: 'Gravatar', key: 'n/a', status: null, quota: 'Illimite' };
    try {
        await checkGravatar('test@test.com');
        gravatar.status = 'OK';
    } catch (e) { gravatar.status = `ERR: ${e.message.substring(0, 30)}`; }
    results.push(gravatar);

    return results;
}

function printHealthTable(results) {
    const line = '='.repeat(70);
    console.log(`\n${line}`);
    console.log('  OSINT Contact Finder v5.0 — Health Check');
    console.log(line);
    console.log('  API            | Cle    | Status     | Quota');
    console.log('  ' + '-'.repeat(66));
    for (const r of results) {
        const key = r.key === true ? 'OK' : r.key === 'n/a' ? 'n/a' : '--';
        const status = r.status === 'OK' ? 'OK   ' : r.status ? r.status.substring(0, 5).padEnd(5) : '--   ';
        const quota = r.quota || '--';
        const name = r.name.padEnd(14);
        console.log(`  ${name} | ${key.padEnd(6)} | ${status.padEnd(10)} | ${quota}`);
    }
    console.log(line + '\n');
}

module.exports = { runHealthCheck, printHealthTable };
