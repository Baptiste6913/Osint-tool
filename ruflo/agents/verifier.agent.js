// ================================================================
// RUFLO AGENT: verifier
// Verifie emails via Gravatar + Hunter verify + Abstract
// Wraps Step 9 du pipeline
// ================================================================
const { KEYS, GENERIC_LOCAL_PARTS } = require('../../src/config');
const { log, sleep } = require('../../src/helpers');
const { sseLog } = require('../../src/sse');
const { checkGravatar } = require('../../src/providers/gravatar');
const { hunterVerify } = require('../../src/providers/hunter');
const { abstractVerify } = require('../../src/providers/abstract');
const { findCandidate, addCandidate } = require('../../src/candidates');

const AGENT_META = {
    name: 'verifier',
    version: '1.0.0',
    description: 'Verifie les emails candidats via Gravatar + Hunter + Abstract',
    capabilities: ['email-verification', 'smtp-check', 'gravatar-check'],
    timeout: 30000,
};

async function execute(ctx) {
    const { candidates, allDomains, exhaustedApis, allPredictions, res } = ctx;

    const emailCandidates = candidates.filter(c => c.type === 'email' && !c.eliminated);
    const sortedForVerify = emailCandidates
        .sort((a, b) => {
            const sa = (a.proximity ? 10 : 0) + (a.isDomainMatch ? 5 : 0) + a.sources.length * 3;
            const sb = (b.proximity ? 10 : 0) + (b.isDomainMatch ? 5 : 0) + b.sources.length * 3;
            return sb - sa;
        })
        .slice(0, 15);

    const predsToVerify = (allPredictions || []).slice(0, 5);
    const allToCheck = [...sortedForVerify.map(c => c.value), ...predsToVerify.map(p => p.email)];
    const uniqueEmails = [...new Set(allToCheck.map(e => e.toLowerCase()))];

    // Gravatar
    sseLog(res, `Gravatar : ${uniqueEmails.length} emails...`, 'verify');
    const gravResults = await Promise.all(uniqueEmails.map(e => checkGravatar(e).then(exists => ({ email: e, exists }))));
    let gravHits = 0;
    for (const gr of gravResults) {
        if (gr.exists) {
            gravHits++;
            const cand = findCandidate(candidates, gr.email, 'email');
            if (cand) cand.gravatarExists = true;
            const pred = predsToVerify.find(p => p.email.toLowerCase() === gr.email);
            if (pred && !findCandidate(candidates, gr.email, 'email')) {
                const nc = addCandidate(candidates, gr.email, 'email', 'Prediction + Gravatar', { isDomainMatch: true });
                nc.gravatarExists = true;
            }
        }
    }
    sseLog(res, `Gravatar : ${gravHits}/${uniqueEmails.length}`, gravHits > 0 ? 'success' : 'info');

    // SMTP verification
    const emailsToVerify = candidates
        .filter(c => c.type === 'email' && !c.eliminated && !c.isOtherEmployee)
        .filter(c => !GENERIC_LOCAL_PARTS.has(c.value.split('@')[0].toLowerCase().replace(/-/g, '')))
        .sort((a, b) => {
            const aS = (a.sources.some(s => s.includes('Apollo') || s.includes('Hunter Finder') || s.includes('Snov')) ? 100 : 0) +
                       (a.sources.some(s => s.includes('match nom')) ? 50 : 0) + (a.proximity ? 20 : 0);
            const bS = (b.sources.some(s => s.includes('Apollo') || s.includes('Hunter Finder') || s.includes('Snov')) ? 100 : 0) +
                       (b.sources.some(s => s.includes('match nom')) ? 50 : 0) + (b.proximity ? 20 : 0);
            return bS - aS;
        })
        .slice(0, 10);

    const predictionsToVerify = [];
    for (const pred of (allPredictions || [])) {
        if (predictionsToVerify.length >= 5) break;
        const predDomain = pred.email.split('@')[1];
        const domainInfo = allDomains.get(predDomain);
        if (domainInfo?.catchAll !== true && domainInfo?.mx?.valid && !findCandidate(candidates, pred.email, 'email')) {
            predictionsToVerify.push(pred);
        }
    }

    let hunterVerifyCount = 0;
    let abstractVerifyCount = 0;
    const HUNTER_LIMIT = 10;
    const ABSTRACT_LIMIT = 10;

    // Hunter verify
    if (KEYS.hunter && !exhaustedApis.has('hunter_verify')) {
        for (const cand of emailsToVerify) {
            if (hunterVerifyCount >= HUNTER_LIMIT || exhaustedApis.has('hunter_verify')) break;
            if (cand.hunterVerified) continue;
            const domainInfo = allDomains.get(cand.value.split('@')[1]);
            if (domainInfo?.catchAll === true) continue;
            try {
                const vr = await hunterVerify(cand.value, exhaustedApis);
                if (vr && vr._quotaExceeded) { sseLog(res, 'Hunter Verify : quota epuise', 'warn'); break; }
                hunterVerifyCount++;
                if (vr) cand.hunterVerified = vr;
            } catch (e) { log(`Hunter verify error: ${e.message}`); }
            await sleep(200);
        }
        for (const pred of predictionsToVerify) {
            if (hunterVerifyCount >= HUNTER_LIMIT + 5 || exhaustedApis.has('hunter_verify')) break;
            if (findCandidate(candidates, pred.email, 'email')) continue;
            try {
                const vr = await hunterVerify(pred.email, exhaustedApis);
                if (vr && vr._quotaExceeded) break;
                hunterVerifyCount++;
                if (vr && (vr.status === 'valid' || vr.result === 'deliverable')) {
                    sseLog(res, `Prediction verifiee : <strong>${pred.email}</strong>`, 'success');
                    const nc = addCandidate(candidates, pred.email, 'email', 'Prédiction vérifiée', { isDomainMatch: true });
                    nc.hunterVerified = vr;
                }
            } catch (e) { log(`Prediction verify error: ${e.message}`); }
            await sleep(200);
        }
    }

    // Abstract fallback
    const useAbstract = KEYS.abstract && (!KEYS.hunter || exhaustedApis.has('hunter_verify'));
    if (useAbstract && !exhaustedApis.has('abstract')) {
        for (const cand of emailsToVerify) {
            if (abstractVerifyCount >= ABSTRACT_LIMIT || exhaustedApis.has('abstract')) break;
            if (cand.abstractVerified) continue;
            const domainInfo = allDomains.get(cand.value.split('@')[1]);
            if (domainInfo?.catchAll === true) continue;
            try {
                const av = await abstractVerify(cand.value, exhaustedApis);
                if (av && av._quotaExceeded) { sseLog(res, 'Abstract : quota epuise', 'warn'); break; }
                abstractVerifyCount++;
                if (av) cand.abstractVerified = av;
            } catch (e) { log(`Abstract verify error: ${e.message}`); }
            await sleep(200);
        }
    }

    return { hunterVerifyCount, abstractVerifyCount };
}

module.exports = { execute, AGENT_META };
