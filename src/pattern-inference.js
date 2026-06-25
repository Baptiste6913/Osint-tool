// ================================================================
// PATTERN INFERENCE — Déduire le pattern email d'un domaine depuis
// une liste d'emails observés (Hunter Domain, extracteur web, etc.)
// Utile quand Hunter ne retourne pas de pattern explicite.
// ================================================================

// Détecte le pattern d'un email {local_part, first_name, last_name}
// Retourne pattern sous forme Hunter (`{first}.{last}`, `{f}{last}`, ...) ou null
function detectPattern(localPart, firstName, lastName) {
    if (!localPart || !firstName || !lastName) return null;
    const l = localPart.toLowerCase();
    const f = firstName.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const ln = lastName.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const fi = f[0] || '';
    const li = ln[0] || '';

    // Tester templates dans l'ordre de spécificité décroissante
    const candidates = [
        { t: `${f}.${ln}`, pattern: '{first}.{last}' },
        { t: `${f}_${ln}`, pattern: '{first}_{last}' },
        { t: `${f}-${ln}`, pattern: '{first}-{last}' },
        { t: `${f}${ln}`, pattern: '{first}{last}' },
        { t: `${fi}${ln}`, pattern: '{f}{last}' },
        { t: `${fi}.${ln}`, pattern: '{f}.{last}' },
        { t: `${fi}_${ln}`, pattern: '{f}_{last}' },
        { t: `${fi}-${ln}`, pattern: '{f}-{last}' },
        { t: `${f}${li}`, pattern: '{first}{l}' },
        { t: `${f}.${li}`, pattern: '{first}.{l}' },
        { t: `${ln}.${f}`, pattern: '{last}.{first}' },
        { t: `${ln}${f}`, pattern: '{last}{first}' },
        { t: f, pattern: '{first}' },
        { t: ln, pattern: '{last}' },
        { t: `${fi}${li}`, pattern: '{f}{l}' },
    ];
    for (const c of candidates) {
        if (l === c.t) return c.pattern;
    }
    return null;
}

// Vote majoritaire sur un ensemble d'emails [{email, first_name, last_name, name}]
// Retourne { pattern, confidence } où confidence = ratio votants / total
function inferPattern(emails) {
    if (!emails || emails.length === 0) return null;
    const votes = new Map();
    let total = 0;

    for (const e of emails) {
        if (!e.email) continue;
        const local = e.email.split('@')[0];
        let firstN = (e.first_name || '').trim();
        let lastN = (e.last_name || '').trim();
        // Fallback : parse "name" si first/last pas dispo
        if ((!firstN || !lastN) && e.name) {
            const parts = e.name.trim().split(/\s+/);
            if (parts.length >= 2) {
                firstN = parts[0];
                lastN = parts.slice(1).join(' ');
            }
        }
        if (!firstN || !lastN) continue;
        total++;
        const p = detectPattern(local, firstN, lastN);
        if (p) votes.set(p, (votes.get(p) || 0) + 1);
    }
    if (total === 0 || votes.size === 0) return null;

    let bestPattern = null, bestCount = 0;
    for (const [p, c] of votes) {
        if (c > bestCount) { bestCount = c; bestPattern = p; }
    }
    return {
        pattern: bestPattern,
        confidence: bestCount / total,
        voters: bestCount,
        total,
    };
}

module.exports = { inferPattern, detectPattern };
