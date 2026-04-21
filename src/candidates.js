// ================================================================
// CANDIDATES — Gestion des candidats (add, find, sources)
// ================================================================

function addCandidate(candidates, value, type, source, extra = {}) {
    const key = value.toLowerCase();
    let existing = candidates.find(c => c.value.toLowerCase() === key && c.type === type);
    if (existing) {
        if (!existing.sources.includes(source)) existing.sources.push(source);
        if (extra.proximity) existing.proximity = true;
        if (extra.isDomainMatch) existing.isDomainMatch = true;
        if (extra.apolloTitle && !existing.apolloTitle) existing.apolloTitle = extra.apolloTitle;
        if (extra.apolloLinkedin && !existing.apolloLinkedin) existing.apolloLinkedin = extra.apolloLinkedin;
        return existing;
    }
    const candidate = {
        value, type, sources: [source], proofs: [], warnings: [], score: 0,
        eliminated: false, eliminatedReason: '',
        proximity: extra.proximity || false,
        isDomainMatch: extra.isDomainMatch || false,
        isGeneric: extra.isGeneric || false,
        hunterVerified: null, abstractVerified: null, gravatarExists: null,
        apolloTitle: extra.apolloTitle || null,
        apolloLinkedin: extra.apolloLinkedin || null,
        pappersConfirmed: extra.pappersConfirmed || false,
        isCompanyPhone: extra.isCompanyPhone || false,
        isOtherEmployee: extra.isOtherEmployee || false,
    };
    candidates.push(candidate);
    return candidate;
}

function findCandidate(candidates, value, type) {
    return candidates.find(c => c.value.toLowerCase() === value.toLowerCase() && c.type === type);
}

function countIndependentSources(candidate) {
    const sourceTypes = new Set();
    for (const source of candidate.sources) {
        if (source.includes('Hunter Finder')) sourceTypes.add('hunter_finder');
        else if (source.includes('Hunter Domain')) sourceTypes.add('hunter_domain');
        else if (source.includes('Apollo')) sourceTypes.add('apollo');
        else if (source.includes('Snov')) sourceTypes.add('snov');
        else if (source.startsWith('http') || source.includes('Jina')) sourceTypes.add('web');
        else if (source.includes('Prediction') || source.includes('Prédiction')) sourceTypes.add('prediction');
        else sourceTypes.add(source);
    }
    if (sourceTypes.has('hunter_finder') && sourceTypes.has('hunter_domain')) sourceTypes.delete('hunter_domain');
    sourceTypes.delete('prediction');
    return sourceTypes.size;
}

module.exports = { addCandidate, findCandidate, countIndependentSources };
