// ================================================================
// SCORING ENGINE — Cross-validation multi-criteres
// ================================================================
const { SCORING, GENERIC_LOCAL_PARTS } = require('./config');
const { countIndependentSources } = require('./candidates');
const { matchesPattern } = require('./predictions');
const { log } = require('./helpers');

function computeScores(candidates, allDomains, hunterPattern, name, pappersInfo) {
    for (const c of candidates) {
        if (c.eliminated) continue;

        let score = 0;
        const proofs = [];
        const warnings = [];

        // === DOMAIN CHECK ===
        if (c.type === 'email') {
            const emailDomain = c.value.split('@')[1];
            const domainInfo = allDomains.get(emailDomain);
            if (domainInfo && domainInfo.mx?.valid === false) {
                c.eliminated = true;
                c.eliminatedReason = `MX invalide pour ${emailDomain}`;
                continue;
            }
            if (domainInfo?.catchAll === true) {
                warnings.push('Domaine catch-all (SMTP non fiable)');
            }
        }

        // === FINDING SOURCES ===
        if (c.sources.some(s => s.includes('Hunter Finder'))) { score += SCORING.HUNTER_FINDER; proofs.push('Trouve par Hunter Email Finder'); }
        if (c.sources.some(s => s.includes('Apollo'))) {
            score += SCORING.APOLLO_FOUND;
            proofs.push(`Trouve par Apollo${c.apolloTitle ? ` (${c.apolloTitle})` : ''}`);
        }
        if (c.sources.some(s => s.includes('Snov'))) { score += SCORING.SNOV_FOUND; proofs.push('Trouve par Snov.io'); }
        if (c.sources.some(s => s.includes('Hunter Domain'))) { score += SCORING.HUNTER_DOMAIN; proofs.push('Present dans le domaine Hunter'); }

        // === CONTEXT ===
        if (c.proximity) { score += SCORING.WEB_PROXIMITY; proofs.push('Trouve a proximite du nom sur le web'); }
        if (c.pappersConfirmed) { score += SCORING.PAPPERS_DIRECTOR; proofs.push('Dirigeant confirme par Pappers'); }

        // === PATTERN ===
        if (c.type === 'email' && c.isDomainMatch) { score += SCORING.DOMAIN_MATCH; proofs.push('Domaine correspondant'); }
        if (c.type === 'email' && hunterPattern && c.isDomainMatch) {
            const local = c.value.split('@')[0];
            if (matchesPattern(local, hunterPattern, name)) { score += SCORING.MATCHES_HUNTER_PATTERN; proofs.push(`Pattern ${hunterPattern}`); }
        }

        // === SMTP VERIFICATION (conditional on catch-all) ===
        if (c.type === 'email') {
            const emailDomain = c.value.split('@')[1];
            const domainInfo = allDomains.get(emailDomain);
            const isCatchAll = domainInfo?.catchAll === true;

            if (c.hunterVerified) {
                if (c.hunterVerified.status === 'valid' || c.hunterVerified.result === 'deliverable') {
                    if (!isCatchAll) { score += SCORING.SMTP_VALID_NON_CATCHALL; proofs.push('SMTP verifie (Hunter)'); }
                } else if ((c.hunterVerified.status === 'invalid' || c.hunterVerified.result === 'undeliverable') && !isCatchAll) {
                    c.eliminated = true;
                    c.eliminatedReason = 'Email invalide (Hunter SMTP)';
                    continue;
                }
            }

            if (c.abstractVerified) {
                if (c.abstractVerified.deliverability === 'DELIVERABLE' && c.abstractVerified.smtpValid && !isCatchAll) {
                    score += SCORING.ABSTRACT_DELIVERABLE;
                    proofs.push('SMTP verifie (Abstract)');
                } else if (c.abstractVerified.deliverability === 'UNDELIVERABLE' && !isCatchAll) {
                    c.eliminated = true;
                    c.eliminatedReason = 'Email invalide (Abstract SMTP)';
                    continue;
                }
                if (c.abstractVerified.disposable) {
                    c.eliminated = true;
                    c.eliminatedReason = 'Email jetable';
                    continue;
                }
            }
        }

        // === GRAVATAR ===
        if (c.gravatarExists) { score += SCORING.GRAVATAR_EXISTS; proofs.push('Gravatar existant'); }

        // === APOLLO ENRICHMENT ===
        if (c.apolloTitle) { score += SCORING.APOLLO_HAS_TITLE; proofs.push(`Poste : ${c.apolloTitle}`); }
        if (c.apolloLinkedin) { score += SCORING.APOLLO_HAS_LINKEDIN; proofs.push('LinkedIn associe'); }

        // === CROSS-VALIDATION ===
        const independentCount = countIndependentSources(c);
        if (independentCount >= 3) { score += SCORING.THREE_INDEPENDENT_SOURCES; proofs.push(`${independentCount} sources independantes`); }
        else if (independentCount >= 2) { score += SCORING.TWO_INDEPENDENT_SOURCES; proofs.push(`${independentCount} sources independantes`); }

        // === PHONE SCORING ===
        if (c.type === 'phone') {
            if (c.sources.some(s => s.includes('Apollo'))) { score += 30; proofs.push('Telephone trouve par Apollo'); }
            if (c.proximity) { score += 20; proofs.push('Associe au nom sur le web'); }
            if (c.isCompanyPhone) { score += 10; proofs.push('Standard entreprise'); warnings.push('Numero entreprise (pas direct)'); }
            if (independentCount >= 2) { score += 20; proofs.push(`${independentCount} sources`); }
        }

        // === LINKEDIN SCORING ===
        if (c.type === 'linkedin') {
            if (c.sources.some(s => s.includes('Apollo'))) { score += 40; proofs.push('LinkedIn trouve par Apollo'); }
            if (c.proximity) { score += 15; proofs.push('Trouve sur le web'); }
            if (independentCount >= 2) { score += 20; proofs.push(`${independentCount} sources`); }
        }

        // === PREDICTION CONFIRMED BY SMTP ===
        if (c.type === 'email' && c.sources.some(s => s.includes('Prediction verifiee') || s.includes('Prédiction vérifiée'))) {
            const emailDomain = c.value.split('@')[1];
            const domainInfo = allDomains.get(emailDomain);
            if (domainInfo?.catchAll !== true) {
                score += 40;
                proofs.push('Prediction confirmee par SMTP (non catch-all)');
            }
        }

        // === OTHER EMPLOYEE PENALTY ===
        if (c.isOtherEmployee) {
            score = Math.min(score, 10);
            warnings.push('Autre employe (pas la personne recherchee)');
        }

        // === GENERIC LOCAL PART PENALTY ===
        if (c.type === 'email') {
            const localPart = c.value.split('@')[0].toLowerCase().replace(/-/g, '');
            if (GENERIC_LOCAL_PARTS.has(localPart)) {
                score = Math.min(score, 5);
                warnings.push('Email generique');
            }
        }

        // === MALUS ===
        if (c.isGeneric && !GENERIC_LOCAL_PARTS.has(c.value.split('@')[0].toLowerCase().replace(/-/g, ''))) {
            score += SCORING.GENERIC_EMAIL; warnings.push('Email generique (extracteur)');
        }
        const isVerifiedPrediction = c.sources.some(s => s.includes('Prediction verifiee') || s.includes('Prédiction vérifiée'));
        if (!c.proximity && independentCount === 0 && c.type === 'email' && !isVerifiedPrediction) { score += SCORING.NO_PROXIMITY_NO_API; warnings.push('Aucune source fiable'); }

        c.score = Math.max(0, score);
        c.proofs = proofs;
        c.warnings = warnings;
        if (score > 0) log(`Score: ${c.value} = ${c.score} [${proofs.join(', ')}]`);
    }
}

module.exports = { computeScores };
