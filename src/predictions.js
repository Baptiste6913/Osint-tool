// ================================================================
// PREDICTIONS — Generation de patterns email + matching
// ================================================================

function generateEmailPatterns(name, domain) {
    const { first, last, firstInitial } = name;
    if (!first || !last) return [];
    return [
        { email: `${first}.${last}@${domain}`, pattern: 'prenom.nom' },
        { email: `${first}${last}@${domain}`, pattern: 'prenomnom' },
        { email: `${firstInitial}${last}@${domain}`, pattern: 'pnom' },
        { email: `${firstInitial}.${last}@${domain}`, pattern: 'p.nom' },
        { email: `${last}.${first}@${domain}`, pattern: 'nom.prenom' },
        { email: `${first}_${last}@${domain}`, pattern: 'prenom_nom' },
        { email: `${first}-${last}@${domain}`, pattern: 'prenom-nom' },
        { email: `${last}${first}@${domain}`, pattern: 'nomprenom' },
        { email: `${first}@${domain}`, pattern: 'prenom' },
        { email: `${last}@${domain}`, pattern: 'nom' },
    ];
}

function matchesPattern(local, pattern, name) {
    if (!pattern || !name) return false;
    const expected = pattern.replace('{first}', name.first).replace('{last}', name.last).replace('{f}', name.firstInitial);
    return local.toLowerCase() === expected.toLowerCase();
}

module.exports = { generateEmailPatterns, matchesPattern };
