// ================================================================
// RUFLO AGENT: api-finder
// Lance Hunter + Snov + Apollo en parallele avec gestion des quotas
// Wraps Steps 3 + 4 du pipeline
// ================================================================
const { KEYS, TIMEOUTS } = require('../../src/config');
const { normalize, log } = require('../../src/helpers');
const { sseLog } = require('../../src/sse');
const { hunterFinder, hunterDomain } = require('../../src/providers/hunter');
const { snovFindEmail } = require('../../src/providers/snov');
const { apolloFindPerson } = require('../../src/providers/apollo');
const { addCandidate } = require('../../src/candidates');

const AGENT_META = {
    name: 'api-finder',
    version: '1.0.0',
    description: 'Lance Hunter + Snov + Apollo en parallele avec gestion des quotas',
    capabilities: ['email-discovery', 'parallel-api-calls', 'quota-management'],
    timeout: 20000,
};

async function execute(ctx) {
    const { domain, name, company, candidates, exhaustedApis, res } = ctx;

    sseLog(res, 'Hunter + Snov + Apollo en parallele...', 'search');

    const apiPromises = [];
    if (KEYS.hunter && !exhaustedApis.has('hunter')) {
        apiPromises.push(hunterFinder(domain, name, exhaustedApis).then(r => ({ type: 'hunterFinder', data: r })).catch(e => ({ type: 'hunterFinder', error: e })));
        apiPromises.push(hunterDomain(domain, exhaustedApis).then(r => ({ type: 'hunterDomain', data: r })).catch(e => ({ type: 'hunterDomain', error: e })));
    }
    if (KEYS.snovId && KEYS.snovSecret && !exhaustedApis.has('snov')) {
        apiPromises.push(snovFindEmail(domain, name, exhaustedApis).then(r => ({ type: 'snov', data: r })).catch(e => ({ type: 'snov', error: e })));
    }
    if (KEYS.apollo && !exhaustedApis.has('apollo')) {
        apiPromises.push(apolloFindPerson(domain, name, company, exhaustedApis).then(r => ({ type: 'apollo', data: r })).catch(e => ({ type: 'apollo', error: e })));
    }

    const apiTimeout = new Promise(resolve => setTimeout(() => resolve('TIMEOUT'), TIMEOUTS.API_PARALLEL));
    const raceResult = await Promise.race([Promise.allSettled(apiPromises), apiTimeout]);
    const apiResults = raceResult === 'TIMEOUT' ? [] : raceResult;
    if (raceResult === 'TIMEOUT') {
        sseLog(res, 'Timeout APIs — certaines sources n\'ont pas repondu', 'warn');
    }

    let hunterPattern = null;
    let apolloResult = null;

    for (const result of apiResults) {
        if (result.status === 'rejected') continue;
        const r = result.value;

        if (r.type === 'hunterFinder' && r.data) {
            if (r.data._quotaExceeded) {
                sseLog(res, 'Hunter : quota epuise', 'warn');
            } else if (r.data.email) {
                sseLog(res, `Hunter Finder : <strong>${r.data.email}</strong> (score: ${r.data.score})`, 'success');
                addCandidate(candidates, r.data.email, 'email', 'Hunter Finder', { isDomainMatch: r.data.email.endsWith('@' + domain), proximity: true });
            }
        } else if (r.type === 'hunterFinder' && r.error) {
            sseLog(res, `Hunter Finder : ${r.error.message || 'erreur'}`, 'warn');
        }

        if (r.type === 'hunterDomain' && r.data) {
            if (r.data._quotaExceeded) sseLog(res, 'Hunter Domain : quota epuise', 'warn');
            hunterPattern = r.data.pattern;
            if (r.data.pattern) sseLog(res, `Hunter pattern : <strong>${r.data.pattern}</strong>`, 'info');
            let matchCount = 0;
            for (const e of r.data.emails) {
                const emailLocal = e.email.split('@')[0].toLowerCase();
                const hunterName = normalize(e.name || '');
                const firstClean = name.first.toLowerCase();
                const lastClean = name.last.toLowerCase();
                const isRelevant = emailLocal.includes(firstClean) || emailLocal.includes(lastClean) ||
                    (lastClean.length > 2 && hunterName.includes(lastClean)) || (firstClean.length > 2 && hunterName.includes(firstClean));
                if (isRelevant) {
                    addCandidate(candidates, e.email, 'email', 'Hunter Domain (match nom)', { isDomainMatch: true, proximity: true });
                    matchCount++;
                } else {
                    addCandidate(candidates, e.email, 'email', 'Hunter Domain (autre)', { isDomainMatch: true, proximity: false, isOtherEmployee: true });
                }
            }
            sseLog(res, `Hunter Domain : ${r.data.emails.length} emails (${matchCount} pertinent(s))`, 'success');
        }

        if (r.type === 'snov' && r.data && r.data.length > 0) {
            if (r.data[0]?._quotaExceeded) {
                sseLog(res, 'Snov.io : quota epuise', 'warn');
            } else {
                for (const e of r.data) {
                    addCandidate(candidates, e.email, 'email', 'Snov.io', { isDomainMatch: e.email.endsWith('@' + domain), proximity: true });
                }
                sseLog(res, `Snov.io : ${r.data.length} emails`, 'success');
            }
        } else if (r.type === 'snov' && r.error) {
            sseLog(res, `Snov.io : ${r.error.message || 'erreur'}`, 'warn');
        }

        if (r.type === 'apollo' && r.data) {
            if (r.data._quotaExceeded) { sseLog(res, 'Apollo : quota epuise', 'warn'); continue; }
            apolloResult = r.data;
            if (r.data.email) {
                addCandidate(candidates, r.data.email, 'email', 'Apollo.io', {
                    isDomainMatch: r.data.email.endsWith('@' + domain), proximity: true,
                    apolloTitle: r.data.title, apolloLinkedin: r.data.linkedin
                });
                sseLog(res, `Apollo : <strong>${r.data.email}</strong>${r.data.title ? ' (' + r.data.title + ')' : ''}`, 'success');
            }
            if (r.data.phones && r.data.phones.length > 0) {
                for (const phone of r.data.phones) {
                    addCandidate(candidates, phone, 'phone', 'Apollo.io', { proximity: true });
                    sseLog(res, `Apollo tel : ${phone}`, 'success');
                }
            }
            if (r.data.linkedin) {
                addCandidate(candidates, r.data.linkedin, 'linkedin', 'Apollo.io', { proximity: true });
                sseLog(res, `Apollo LinkedIn : ${r.data.linkedin}`, 'success');
            }
        } else if (r.type === 'apollo' && r.error) {
            sseLog(res, `Apollo : ${r.error.message || 'erreur'}`, 'warn');
        }
    }

    return { hunterPattern, apolloResult };
}

module.exports = { execute, AGENT_META };
