// ================================================================
// API: PAPPERS (recherche + disambiguation + enrichment)
// ================================================================
const { fetchWithTimeout, log } = require('../helpers');
const { KEYS, TIMEOUTS } = require('../config');

async function pappersSearch(companyName) {
    if (!KEYS.pappers) return null;
    try {
        const r = await fetchWithTimeout(
            `https://api.pappers.fr/v2/recherche?q=${encodeURIComponent(companyName)}&par_page=5&api_token=${encodeURIComponent(KEYS.pappers)}`,
            {}, TIMEOUTS.PAPPERS
        );
        const data = await r.json();
        if (!data.resultats || data.resultats.length === 0) return null;

        let best = data.resultats[0];

        // Disambiguation: score each result if multiple
        if (data.resultats.length > 1) {
            const queryUp = companyName.toUpperCase().trim();
            const stopWords = new Set(['DE','DU','DES','LE','LA','LES','ET','EN','AU','AUX','SA','SAS','SARL','SCI','EURL']);
            const scored = data.resultats.map(r2 => {
                let s = 0;
                const nom = (r2.denomination || r2.nom_entreprise || '').toUpperCase().trim();

                // === NOM ===
                if (nom === queryUp) {
                    s += 300;
                } else {
                    const queryWords = queryUp.split(/\s+/).filter(w => w.length > 1 && !stopWords.has(w));
                    const nomWords = nom.split(/\s+/).filter(w => w.length > 1 && !stopWords.has(w));
                    let matchCount = 0;
                    for (const qw of queryWords) {
                        if (nomWords.some(nw => nw.includes(qw) || qw.includes(nw))) matchCount++;
                    }
                    if (queryWords.length > 0) s += Math.round((matchCount / queryWords.length) * 150);
                }

                if (/\s\d{1,3}$/.test(nom)) s -= 80;

                const filialeKw = ['EXPANSION','HOLDING','INVEST','CAPITAL','IMMOBILIER','GESTION','PATRIMOINE','DEVELOPPEMENT','SERVICES','INTERNATIONAL','GROUP','PARTNERS'];
                for (const kw of filialeKw) { if (nom.includes(kw) && !queryUp.includes(kw)) s -= 50; }

                const regionKw = ['ALSACE','BRETAGNE','NORMANDIE','OCCITANIE','AQUITAINE','PROVENCE','RHONE','ALPES','LOIRE','PICARDIE',
                    'BOURGOGNE','FRANCHE','COMTE','AUVERGNE','LORRAINE','CHAMPAGNE','ARDENNE','LANGUEDOC','ROUSSILLON',
                    'POITOU','CHARENTES','LIMOUSIN','CORSE','REUNION','MARTINIQUE','GUADELOUPE','GUYANE','MAYOTTE',
                    'ILE DE FRANCE','HAUTS DE FRANCE','GRAND EST','PAYS DE LA LOIRE','CENTRE','NORD','SUD','EST','OUEST'];
                for (const kw of regionKw) { if (nom.includes(kw) && !queryUp.includes(kw)) s -= 60; }

                // Bonus: nom identique en longueur (pas de mots supplementaires)
                const queryWordsClean = queryUp.split(/\s+/).filter(w => w.length > 1 && !stopWords.has(w));
                const nomWordsClean = nom.split(/\s+/).filter(w => w.length > 1 && !stopWords.has(w));
                if (nomWordsClean.length === queryWordsClean.length) s += 40;
                else if (nomWordsClean.length > queryWordsClean.length) s -= (nomWordsClean.length - queryWordsClean.length) * 25;

                if (!r2.entreprise_cessee) s += 50;

                const effectif = parseInt(r2.effectif) || parseInt(r2.tranche_effectif) || 0;
                if (effectif > 500) s += 60;
                else if (effectif > 100) s += 40;
                else if (effectif > 20) s += 20;
                else if (effectif > 0) s += 5;

                const forme = (r2.forme_juridique || '').toUpperCase();
                if (forme.includes('SA ') || forme === 'SA') s += 15;
                if (forme.includes('SAS')) s += 10;
                if (forme.includes('ASSOCIATION')) s += 5;

                const cp = r2.siege?.code_postal || '';
                if (cp.startsWith('75')) s += 20;
                else if (['77','78','91','92','93','94','95'].some(d => cp.startsWith(d))) s += 10;

                if (nom.includes('CAISSE REGIONALE') || nom.includes('FEDERATION') || nom.includes('NATIONALE') || nom.includes('MUTUEL')) s += 30;

                return { ...r2, _score: s };
            });
            scored.sort((a, b) => b._score - a._score);
            best = scored[0];
            if (scored.length >= 2 && scored[0]._score - scored[1]._score < 20) {
                best._ambiguous = true;
                best._alternatives = scored.slice(1, 3).map(a => a.denomination || a.nom_entreprise || '');
            }
        }

        const result = {
            nom: best.denomination || best.nom_entreprise || companyName,
            siren: best.siren || '',
            siege: best.siege ? `${best.siege.adresse || ''}, ${best.siege.code_postal || ''} ${best.siege.ville || ''}` : '',
            dirigeants: (best.representants || []).map(d => ({ nom: d.nom || '', prenom: d.prenom || '', fonction: d.qualite || '' })),
            sitesWeb: best.sites_web || [],
            domaine: null,
            telephone: null,
            _ambiguous: best._ambiguous || false,
            _alternatives: best._alternatives || [],
        };

        // Enrichment: get full company details via SIREN
        if (best.siren) {
            try {
                const r2 = await fetchWithTimeout(
                    `https://api.pappers.fr/v2/entreprise?siren=${best.siren}&api_token=${encodeURIComponent(KEYS.pappers)}`,
                    {}, TIMEOUTS.PAPPERS
                );
                const full = await r2.json();
                if (full.site_web) {
                    const d = full.site_web.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
                    result.domaine = d;
                    if (!result.sitesWeb.includes(full.site_web)) result.sitesWeb.push(full.site_web);
                }
                if (full.telephone) result.telephone = full.telephone;
                if (full.email && !result.email) result.email = full.email;
                if (full.representants && full.representants.length > result.dirigeants.length) {
                    result.dirigeants = full.representants.map(d => ({ nom: d.nom || '', prenom: d.prenom || '', fonction: d.qualite || '' }));
                }
            } catch (e) { log(`Pappers enrich error: ${e.message}`); }
        }

        return result;
    } catch (e) { log(`Pappers error: ${e.message}`); }
    return null;
}

module.exports = { pappersSearch };
