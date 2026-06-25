// ================================================================
// PATTERN STATS — Distributions statistiques par pays/industrie
// Basé sur études publiques (Hunter/Snov/Apollo reports 2023-2024)
// Utilisé pour re-prioriser les predictions selon le contexte.
// ================================================================

// Distribution par TLD (signal pays)
const BY_TLD = {
    fr: { '{first}.{last}': 0.55, '{f}{last}': 0.12, '{f}.{last}': 0.13, '{first}{last}': 0.10, '{last}.{first}': 0.04, '{first}': 0.03, '{last}': 0.03 },
    com: { '{first}.{last}': 0.45, '{first}{last}': 0.12, '{f}{last}': 0.18, '{f}.{last}': 0.08, '{first}': 0.07, '{last}': 0.05, '{first}-{last}': 0.05 },
    io: { '{first}.{last}': 0.55, '{first}': 0.15, '{first}{last}': 0.10, '{f}{last}': 0.10, '{f}.{last}': 0.10 },
    co: { '{first}.{last}': 0.50, '{first}': 0.15, '{f}{last}': 0.12, '{first}{last}': 0.10, '{f}.{last}': 0.08, '{last}': 0.05 },
    uk: { '{first}.{last}': 0.45, '{f}.{last}': 0.15, '{f}{last}': 0.15, '{first}{last}': 0.10, '{first}': 0.10, '{last}': 0.05 },
    de: { '{first}.{last}': 0.60, '{last}': 0.10, '{f}.{last}': 0.10, '{first}{last}': 0.10, '{f}{last}': 0.10 },
};

// Distribution par mots-clés dans le nom (industrie)
const INDUSTRY_KEYWORDS = {
    tech: ['tech', 'labs', 'software', 'digital', 'app', 'dev', 'ai', 'io', 'cloud', 'data'],
    consulting: ['consulting', 'advisory', 'partners', 'advisors', 'strategy', 'cabinet'],
    law: ['avocat', 'law', 'legal', 'attorney', 'juridique', 'notaire', 'associes'],
    finance: ['capital', 'invest', 'bank', 'banque', 'finance', 'asset', 'patrimoine'],
    realestate: ['immobilier', 'real estate', 'realty', 'property'],
    hr: ['rh', 'human', 'talents', 'recrut', 'staffing'],
};

const BY_INDUSTRY = {
    tech: { '{first}.{last}': 0.55, '{first}': 0.15, '{f}{last}': 0.12, '{first}{last}': 0.10, '{last}': 0.05 },
    consulting: { '{first}.{last}': 0.60, '{f}.{last}': 0.18, '{f}{last}': 0.12, '{first}': 0.05 },
    law: { '{f}.{last}': 0.40, '{first}.{l}': 0.20, '{first}.{last}': 0.25, '{f}{last}': 0.10 },
    finance: { '{first}.{last}': 0.50, '{f}.{last}': 0.15, '{last}.{first}': 0.15, '{f}{last}': 0.10, '{first}{last}': 0.10 },
    realestate: { '{first}.{last}': 0.50, '{first}': 0.15, '{f}{last}': 0.15, '{first}{last}': 0.10 },
    hr: { '{first}.{last}': 0.55, '{first}': 0.15, '{f}{last}': 0.15, '{f}.{last}': 0.10 },
};

function detectTldKey(domain) {
    if (!domain) return 'com';
    const tld = domain.split('.').pop().toLowerCase();
    return BY_TLD[tld] ? tld : 'com';
}

function detectIndustry(companyName) {
    if (!companyName) return null;
    const lower = companyName.toLowerCase();
    for (const [industry, kws] of Object.entries(INDUSTRY_KEYWORDS)) {
        for (const kw of kws) {
            if (lower.includes(kw)) return industry;
        }
    }
    return null;
}

// Retourne la probabilité statistique qu'un pattern Hunter ("{first}.{last}") soit utilisé
// par ce domaine/company. Combine TLD + industrie.
function patternProbability(patternHunter, domain, companyName) {
    const tld = detectTldKey(domain);
    const tldDist = BY_TLD[tld] || BY_TLD.com;
    const tldP = tldDist[patternHunter] || 0.02;

    const industry = detectIndustry(companyName);
    if (!industry) return tldP;
    const indDist = BY_INDUSTRY[industry];
    const indP = indDist ? (indDist[patternHunter] || 0.02) : tldP;

    // Weighted mix : industrie 60%, TLD 40%
    return 0.6 * indP + 0.4 * tldP;
}

// Reprioriser un tableau de predictions selon les stats
// Convertit le "pattern" custom de predictions.js vers le format Hunter pour matcher
const CUSTOM_TO_HUNTER = {
    'prenom.nom': '{first}.{last}',
    'prenomnom': '{first}{last}',
    'pnom': '{f}{last}',
    'p.nom': '{f}.{last}',
    'nom.prenom': '{last}.{first}',
    'nomprenom': '{last}{first}',
    'prenom_nom': '{first}_{last}',
    'prenom-nom': '{first}-{last}',
    'prenom': '{first}',
    'nom': '{last}',
    'prenoml': '{first}{l}',
    'prenom.l': '{first}.{l}',
};

function reprioritizeByStats(predictions, domain, companyName) {
    for (const p of predictions) {
        const hunterForm = CUSTOM_TO_HUNTER[p.pattern];
        if (!hunterForm) continue;
        const prob = patternProbability(hunterForm, domain, companyName);
        // Booster la priorité : +prob*50
        p.priority += Math.round(prob * 50);
        p.statsProb = prob;
    }
    predictions.sort((a, b) => b.priority - a.priority);
    return predictions;
}

module.exports = { patternProbability, reprioritizeByStats, detectTldKey, detectIndustry };
