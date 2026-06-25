// ================================================================
// PREDICTIONS — Génération exhaustive de patterns email
// Entrée : parsed name (avec firstParts, lastParts, diminutifs...)
// Sortie : [{email, pattern, priority}] triés par probabilité décroissante
// ================================================================
const { getNameVariants } = require('./diminutives');

// Patterns paramétriques ({f}=first, {l}=last, {fi}=first initial, {li}=last initial)
// priority = score heuristique (plus élevé = tenter en premier pour verify)
const PATTERN_TEMPLATES = [
    // --- Classiques ---
    { t: '{f}.{l}', p: 'prenom.nom', priority: 100 },
    { t: '{f}{l}', p: 'prenomnom', priority: 85 },
    { t: '{f}_{l}', p: 'prenom_nom', priority: 55 },
    { t: '{f}-{l}', p: 'prenom-nom', priority: 50 },
    // --- Initiale prénom ---
    { t: '{fi}{l}', p: 'pnom', priority: 80 },
    { t: '{fi}.{l}', p: 'p.nom', priority: 78 },
    { t: '{fi}_{l}', p: 'p_nom', priority: 30 },
    { t: '{fi}-{l}', p: 'p-nom', priority: 28 },
    // --- Initiale nom ---
    { t: '{f}{li}', p: 'prenoml', priority: 40 },
    { t: '{f}.{li}', p: 'prenom.l', priority: 45 },
    { t: '{f}_{li}', p: 'prenom_l', priority: 20 },
    { t: '{f}-{li}', p: 'prenom-l', priority: 18 },
    // --- Ordre inverse ---
    { t: '{l}.{f}', p: 'nom.prenom', priority: 55 },
    { t: '{l}{f}', p: 'nomprenom', priority: 40 },
    { t: '{l}{fi}', p: 'noml', priority: 35 },
    { t: '{l}.{fi}', p: 'nom.l', priority: 30 },
    // --- Prénom seul ou nom seul ---
    { t: '{f}', p: 'prenom', priority: 25 },
    { t: '{l}', p: 'nom', priority: 22 },
    // --- Initiales seules ---
    { t: '{fi}{li}', p: 'initiales', priority: 15 },
    { t: '{fi}.{li}', p: 'i.i', priority: 12 },
];

// Patterns role-based (si title disponible)
const ROLE_LOCAL_PARTS = {
    ceo: ['ceo', 'direction', 'dg', 'pdg'],
    founder: ['founder', 'fondateur'],
    cofounder: ['cofounder', 'cofondateur'],
    president: ['president', 'pres'],
    cto: ['cto', 'tech', 'it'],
    cfo: ['cfo', 'finance', 'daf'],
    coo: ['coo', 'operations', 'ops'],
    cmo: ['cmo', 'marketing', 'mkt'],
    chro: ['chro', 'rh', 'hr'],
    sales: ['sales', 'commercial', 'vente'],
    'sales manager': ['sales', 'commercial'],
    'head of sales': ['sales', 'commercial'],
    marketing: ['marketing', 'mkt', 'com'],
    'head of marketing': ['marketing', 'mkt'],
    hr: ['hr', 'rh', 'recrutement'],
    'head of hr': ['hr', 'rh'],
    finance: ['finance', 'comptabilite', 'compta'],
    legal: ['legal', 'juridique'],
    product: ['product', 'produit', 'po'],
    engineering: ['engineering', 'tech', 'dev'],
    'head of engineering': ['engineering', 'tech'],
    support: ['support', 'aide'],
    customer: ['customer', 'client', 'cs'],
};

// Industrie → ordre préférentiel de patterns (stats publiques US/FR)
// Utilisé pour re-prioriser selon contexte
const INDUSTRY_PATTERN_HINTS = {
    tech: ['prenom.nom', 'pnom', 'p.nom', 'prenom', 'nom'],
    consulting: ['prenom.nom', 'p.nom', 'pnom'],
    law: ['prenom.l', 'prenom.nom', 'pnom'],
    finance: ['prenom.nom', 'p.nom', 'nom.prenom'],
    'fr-default': ['prenom.nom', 'p.nom', 'pnom', 'prenom-nom'],
    'us-default': ['prenom.nom', 'pnom', 'prenom'],
};

// Produit une version "courte" (tronquée à 10 chars) pour les noms longs
function truncate(s, max = 10) {
    return s.length > max ? s.substring(0, max) : s;
}

function fillTemplate(t, vars) {
    return t.replace('{f}', vars.f).replace('{l}', vars.l).replace('{fi}', vars.fi).replace('{li}', vars.li);
}

// ================================================================
// Génère tous les patterns pour un (name, domain) donné.
// Inclut : variantes prénom (diminutifs), variantes nom (avec/sans particules),
// versions tronquées, versions avec tiret du prénom composé.
// ================================================================
function generateEmailPatterns(name, domain, options = {}) {
    const { first, last, firstInitial, firstInitials, firstParts, lastParts } = name;
    if (!first || !last) return [];

    const seen = new Set();
    const out = [];

    // 1. Variantes du prénom : officiel, diminutifs, composé (Jean-Pierre → ['jeanpierre', 'jean-pierre', 'jp', 'jean', 'pierre'])
    const firstVariants = new Set([first]);
    // Ajouter diminutifs du prénom principal
    for (const v of getNameVariants(first)) firstVariants.add(v);
    // Si prénom composé : ajouter chaque partie individuellement + initiales combinées
    if (firstParts && firstParts.length > 1) {
        firstVariants.add(firstParts.join('-'));      // "jean-pierre"
        firstVariants.add(firstInitials);             // "jp"
        for (const p of firstParts) firstVariants.add(p); // "jean", "pierre"
    }
    // Variantes tronquées (noms longs : "maximilien" → "maxim")
    for (const fv of [...firstVariants]) {
        if (fv.length > 10) firstVariants.add(truncate(fv, 8));
    }

    // 2. Variantes du nom : compact ("delarochefoucauld"), avec tiret ("de-la-rochefoucauld"),
    // dernière partie seule ("rochefoucauld"), toutes parts concaténées
    const lastVariants = new Set([last]);
    if (lastParts && lastParts.length > 1) {
        lastVariants.add(lastParts.join('-'));
        lastVariants.add(lastParts[lastParts.length - 1]); // dernière partie seule (très courante)
    }
    if (lastParts && lastParts.length >= 1) {
        // Ajouter version tronquée pour noms longs
        for (const lv of [...lastVariants]) {
            if (lv.length > 12) lastVariants.add(truncate(lv, 10));
        }
    }

    // 3. Générer toutes les combinaisons (prenom × nom × template)
    for (const fv of firstVariants) {
        if (!fv) continue;
        for (const lv of lastVariants) {
            if (!lv) continue;
            const vars = { f: fv, l: lv, fi: fv[0] || firstInitial, li: lv[0] || '' };
            for (const tpl of PATTERN_TEMPLATES) {
                const local = fillTemplate(tpl.t, vars);
                // Reject malformés
                if (!local || local.length < 1 || local.length > 64) continue;
                if (/^[_.\-]/.test(local) || /[_.\-]$/.test(local)) continue; // pas de début/fin avec séparateur
                const email = `${local}@${domain}`;
                if (seen.has(email)) continue;
                seen.add(email);

                // Priorité ajustée : patterns avec la forme officielle du prénom > diminutifs
                let priority = tpl.priority;
                if (fv !== first) priority -= 20; // diminutif / variante
                if (lv !== last) priority -= 10; // variante nom

                out.push({ email, pattern: tpl.p, priority, firstVariant: fv, lastVariant: lv });
            }
        }
    }

    // 4. Role-based (si title fourni)
    if (options.title) {
        const titleLower = options.title.toLowerCase();
        for (const [role, locals] of Object.entries(ROLE_LOCAL_PARTS)) {
            if (titleLower.includes(role)) {
                for (const local of locals) {
                    const email = `${local}@${domain}`;
                    if (!seen.has(email)) {
                        seen.add(email);
                        out.push({ email, pattern: `role:${role}`, priority: 10, firstVariant: '', lastVariant: '' });
                    }
                }
            }
        }
    }

    // Tri par priorité décroissante
    out.sort((a, b) => b.priority - a.priority);
    return out;
}

// ================================================================
// Match pattern Hunter (type "{first}.{last}") contre un local part
// ================================================================
function matchesPattern(local, pattern, name) {
    if (!pattern || !name) return false;
    // Pour prénom : essayer forme concat ("jeanpierre"), forme avec tiret ("jean-pierre"),
    // et chaque composant individuel ("jean", "pierre")
    const firstCandidates = new Set([name.first]);
    if (name.firstParts && name.firstParts.length > 1) {
        firstCandidates.add(name.firstParts.join('-'));
        for (const p of name.firstParts) firstCandidates.add(p);
    }
    for (const v of getNameVariants(name.first)) firstCandidates.add(v);

    const lastCandidates = new Set([name.last]);
    if (name.lastParts && name.lastParts.length > 1) {
        lastCandidates.add(name.lastParts.join('-'));
        lastCandidates.add(name.lastParts[name.lastParts.length - 1]);
    }

    const localLower = local.toLowerCase();
    for (const f of firstCandidates) {
        for (const l of lastCandidates) {
            if (!f || !l) continue;
            const expected = pattern
                .replace('{first}', f)
                .replace('{last}', l)
                .replace('{f}', f[0]);
            if (localLower === expected.toLowerCase()) return true;
        }
    }
    return false;
}

// ================================================================
// Re-priorisation par industrie/pays
// ================================================================
function reprioritizeByIndustry(patterns, industry) {
    const hints = INDUSTRY_PATTERN_HINTS[industry] || INDUSTRY_PATTERN_HINTS['fr-default'];
    for (const p of patterns) {
        const idx = hints.indexOf(p.pattern);
        if (idx >= 0) p.priority += (hints.length - idx) * 5;
    }
    patterns.sort((a, b) => b.priority - a.priority);
    return patterns;
}

module.exports = { generateEmailPatterns, matchesPattern, reprioritizeByIndustry, PATTERN_TEMPLATES, ROLE_LOCAL_PARTS };
