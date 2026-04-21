// ================================================================
// RUFLO AGENT: scorer
// Calcule les scores, classe, et produit le resultat final
// Wraps Steps 10 + 11 du pipeline
// ================================================================
const { sseLog } = require('../../src/sse');
const { computeScores } = require('../../src/scoring');
const { findCandidate } = require('../../src/candidates');
const { generateDorks } = require('../../src/dorks');

const AGENT_META = {
    name: 'scorer',
    version: '1.0.0',
    description: 'Calcule les scores, classe, et produit le resultat final',
    capabilities: ['scoring', 'classification', 'result-formatting'],
    timeout: 5000,
};

async function execute(ctx) {
    const { candidates, allDomains, hunterPattern, name, pappersInfo, fullname, company, domain, allPredictions, sources, scanStart, res } = ctx;

    // Step 10: Scoring
    computeScores(candidates, allDomains, hunterPattern, name, pappersInfo);

    for (const c of candidates) {
        if (c.eliminated) continue;
        if (c.type === 'email' && c.isGeneric && !c.proximity && c.score < 10) {
            c.eliminated = true;
            c.eliminatedReason = 'Email generique sans lien';
            continue;
        }
        const hasStrongSource = c.sources.some(s =>
            s.includes('Apollo') || s.includes('Hunter Finder') || s.includes('Snov') || s.includes('Prédiction vérifiée')
        );
        if (hasStrongSource) continue;
        if (c.score < 10 && c.score > 0) {
            c.eliminated = true;
            c.eliminatedReason = 'Score trop bas et aucune source fiable';
        }
    }

    // Step 11: Results
    const elapsed = ((Date.now() - scanStart) / 1000).toFixed(1);
    const mainActive = candidates.filter(c => !c.eliminated && !c.isOtherEmployee);
    const otherEmployees = candidates.filter(c => !c.eliminated && c.isOtherEmployee && c.score > 0).sort((a, b) => b.score - a.score);
    const eliminated = candidates.filter(c => c.eliminated);

    const verified = mainActive.filter(c => c.score >= 90).sort((a, b) => b.score - a.score);
    const probable = mainActive.filter(c => c.score >= 60 && c.score < 90).sort((a, b) => b.score - a.score);
    const possible = mainActive.filter(c => c.score >= 30 && c.score < 60).sort((a, b) => b.score - a.score);
    const low = mainActive.filter(c => c.score >= 10 && c.score < 30);

    const clean = c => ({
        value: c.value, type: c.type, sources: c.sources, proofs: c.proofs, warnings: c.warnings || [], score: c.score,
        eliminated: c.eliminated, eliminatedReason: c.eliminatedReason,
        proximity: c.proximity, isDomainMatch: c.isDomainMatch, isGeneric: c.isGeneric,
        apolloTitle: c.apolloTitle, apolloLinkedin: c.apolloLinkedin,
    });

    const predsFiltered = (allPredictions || []).filter(p => !findCandidate(candidates, p.email, 'email'));
    const seenUrls = new Set();
    const uniqueSources = (sources || []).filter(s => { if (seenUrls.has(s.url)) return false; seenUrls.add(s.url); return true; });

    const domainsInfo = {};
    for (const [d, info] of allDomains) {
        domainsInfo[d] = { mxValid: info.mx?.valid || false, catchAll: info.catchAll, source: info.source };
    }

    return {
        elapsed: parseFloat(elapsed), domain, domainsInfo, hunterPattern, pappersInfo,
        verified: verified.map(clean), probable: probable.map(clean), possible: possible.map(clean),
        otherEmployees: otherEmployees.map(clean),
        eliminated: [...eliminated, ...low].map(clean),
        predictions: predsFiltered.slice(0, 20),
        sources: uniqueSources,
        dorks: generateDorks(fullname, company, domain),
        summary: { verified: verified.length, probable: probable.length, possible: possible.length, otherEmployees: otherEmployees.length, eliminated: eliminated.length + low.length, sources: uniqueSources.length }
    };
}

module.exports = { execute, AGENT_META };
