// ================================================================
// SCORING ENGINE v6 — Cross-validation multi-critères
// + GitHub, Wayback, EmailRep, RDAP, SMTP direct, reverse
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
            if (domainInfo?.mx?.valid === false) {
                c.eliminated = true; c.eliminatedReason = `MX invalide pour ${emailDomain}`;
                continue;
            }
            if (domainInfo?.catchAll === true) warnings.push('Domaine catch-all (SMTP peu fiable)');
        }

        // === FINDING SOURCES ===
        if (c.sources.some(s => s.includes('Hunter Finder'))) { score += SCORING.HUNTER_FINDER; proofs.push('Hunter Email Finder'); }
        if (c.sources.some(s => s.includes('Apollo'))) {
            score += SCORING.APOLLO_FOUND;
            proofs.push(`Apollo${c.apolloTitle ? ` (${c.apolloTitle})` : ''}`);
        }
        if (c.sources.some(s => s.includes('Snov'))) { score += SCORING.SNOV_FOUND; proofs.push('Snov.io'); }
        if (c.sources.some(s => s.includes('Hunter Domain'))) { score += SCORING.HUNTER_DOMAIN; proofs.push('Hunter Domain'); }

        // v6: GitHub
        if (c.sources.some(s => s.includes('GitHub'))) {
            score += SCORING.GITHUB_COMMIT_EMAIL;
            proofs.push(`GitHub${c.githubLogin ? ` (${c.githubLogin})` : ''}`);
        }
        // v6: Wayback
        if (c.sources.some(s => s.startsWith('Wayback'))) {
            score += SCORING.WAYBACK_ARCHIVED_CONTACT;
            proofs.push('Page archivée (Wayback)');
        }
        // v6: RDAP
        if (c.sources.some(s => s.includes('RDAP'))) {
            score += SCORING.WHOIS_REGISTRANT;
            proofs.push('Registrant WHOIS');
        }

        // === CONTEXT ===
        if (c.proximity) { score += SCORING.WEB_PROXIMITY; proofs.push('Proche du nom sur web'); }
        if (c.pappersConfirmed) { score += SCORING.PAPPERS_DIRECTOR; proofs.push('Dirigeant confirmé (Pappers)'); }

        // === PATTERN ===
        if (c.type === 'email' && c.isDomainMatch) { score += SCORING.DOMAIN_MATCH; proofs.push('Domaine correspond'); }
        if (c.type === 'email' && hunterPattern && c.isDomainMatch) {
            const local = c.value.split('@')[0];
            if (matchesPattern(local, hunterPattern, name)) {
                score += SCORING.MATCHES_HUNTER_PATTERN;
                proofs.push(`Pattern ${hunterPattern}`);
            }
        }

        // === SMTP VERIFICATION ===
        if (c.type === 'email') {
            const emailDomain = c.value.split('@')[1];
            const domainInfo = allDomains.get(emailDomain);
            const isCatchAll = domainInfo?.catchAll === true;

            if (c.hunterVerified) {
                if (c.hunterVerified.status === 'valid' || c.hunterVerified.result === 'deliverable') {
                    if (!isCatchAll) { score += SCORING.SMTP_VALID_NON_CATCHALL; proofs.push('SMTP vérifié (Hunter)'); }
                } else if ((c.hunterVerified.status === 'invalid' || c.hunterVerified.result === 'undeliverable') && !isCatchAll) {
                    c.eliminated = true; c.eliminatedReason = 'Email invalide (Hunter SMTP)';
                    continue;
                }
            }
            if (c.abstractVerified) {
                if (c.abstractVerified.deliverability === 'DELIVERABLE' && c.abstractVerified.smtpValid && !isCatchAll) {
                    score += SCORING.ABSTRACT_DELIVERABLE;
                    proofs.push('SMTP vérifié (Abstract)');
                } else if (c.abstractVerified.deliverability === 'UNDELIVERABLE' && !isCatchAll) {
                    c.eliminated = true; c.eliminatedReason = 'Email invalide (Abstract SMTP)';
                    continue;
                }
                if (c.abstractVerified.disposable) {
                    c.eliminated = true; c.eliminatedReason = 'Email jetable';
                    continue;
                }
            }
            // v6: SMTP direct
            if (c.smtpDirect) {
                if (c.smtpDirect.valid === true && !isCatchAll) {
                    score += SCORING.SMTP_DIRECT_DELIVERABLE;
                    proofs.push('SMTP direct deliverable');
                } else if (c.smtpDirect.valid === false && !isCatchAll) {
                    // Pas d'élimination stricte (plus de faux-négatifs que Hunter)
                    warnings.push(`SMTP direct reject (${c.smtpDirect.reason})`);
                    score -= 10;
                }
            }
        }

        // === GRAVATAR ===
        if (c.gravatarExists) { score += SCORING.GRAVATAR_EXISTS; proofs.push('Gravatar présent'); }

        // === APOLLO ENRICHMENT ===
        if (c.apolloTitle) { score += SCORING.APOLLO_HAS_TITLE; proofs.push(`Titre : ${c.apolloTitle}`); }
        if (c.apolloLinkedin) { score += SCORING.APOLLO_HAS_LINKEDIN; proofs.push('LinkedIn associé'); }

        // === v6: EmailRep réputation ===
        if (c.emailRep) {
            if (c.emailRep.reputation === 'high') {
                score += SCORING.EMAILREP_REPUTATION;
                proofs.push('EmailRep: réputation HIGH');
            } else if (c.emailRep.reputation === 'low') {
                warnings.push('EmailRep: réputation LOW');
                score -= 5;
            }
            if (c.emailRep.malicious || c.emailRep.blacklisted) {
                warnings.push('EmailRep: malveillant/blacklist');
                score -= 20;
            }
            if (c.emailRep.references > 5) {
                score += 3;
                proofs.push(`${c.emailRep.references} références publiques`);
            }
            if (c.emailRep.detailsCredentialsLeaked) warnings.push('Credentials leaked');
        }

        // === v6: REVERSE CROSS-CHECK ===
        if (c.reverseConfirmed) {
            score += SCORING.REVERSE_WEB_CONFIRMED;
            proofs.push('Cross-check: email + nom sur web');
        }

        // === CROSS-VALIDATION ===
        const independentCount = countIndependentSources(c);
        if (independentCount >= 3) { score += SCORING.THREE_INDEPENDENT_SOURCES; proofs.push(`${independentCount} sources indépendantes`); }
        else if (independentCount >= 2) { score += SCORING.TWO_INDEPENDENT_SOURCES; proofs.push(`${independentCount} sources indépendantes`); }

        // === PHONE ===
        if (c.type === 'phone') {
            if (c.sources.some(s => s.includes('Apollo'))) { score += 30; proofs.push('Téléphone Apollo'); }
            if (c.proximity) { score += 20; proofs.push('Associé au nom web'); }
            if (c.isCompanyPhone) { score += 10; proofs.push('Standard entreprise'); warnings.push('Numéro entreprise (pas direct)'); }
            if (independentCount >= 2) { score += 20; proofs.push(`${independentCount} sources`); }
        }

        // === LINKEDIN ===
        if (c.type === 'linkedin') {
            if (c.sources.some(s => s.includes('Apollo'))) { score += 40; proofs.push('LinkedIn Apollo'); }
            if (c.proximity) { score += 15; proofs.push('Trouvé sur web'); }
            if (independentCount >= 2) { score += 20; proofs.push(`${independentCount} sources`); }
        }

        // === PREDICTION CONFIRMED ===
        if (c.type === 'email' && c.sources.some(s => /Prédiction vérifiée|Prediction verifiee/.test(s))) {
            const emailDomain = c.value.split('@')[1];
            const domainInfo = allDomains.get(emailDomain);
            if (domainInfo?.catchAll !== true) {
                score += 40;
                proofs.push('Prédiction confirmée SMTP');
            }
        }

        // === OTHER EMPLOYEE PENALTY ===
        if (c.isOtherEmployee) {
            score = Math.min(score, 10);
            warnings.push('Autre employé (pas la cible)');
        }

        // === GENERIC LOCAL PART PENALTY ===
        if (c.type === 'email') {
            const localPart = c.value.split('@')[0].toLowerCase().replace(/-/g, '');
            if (GENERIC_LOCAL_PARTS.has(localPart)) {
                score = Math.min(score, 5);
                warnings.push('Email générique');
            }
        }

        // === MALUS ===
        if (c.isGeneric && !GENERIC_LOCAL_PARTS.has(c.value.split('@')[0].toLowerCase().replace(/-/g, ''))) {
            score += SCORING.GENERIC_EMAIL; warnings.push('Email générique (extracteur)');
        }
        const isVerifiedPrediction = c.sources.some(s => /Prédiction vérifiée|Prediction verifiee/.test(s));
        if (!c.proximity && independentCount === 0 && c.type === 'email' && !isVerifiedPrediction) {
            score += SCORING.NO_PROXIMITY_NO_API; warnings.push('Aucune source fiable');
        }

        c.score = Math.max(0, score);
        c.proofs = proofs;
        c.warnings = warnings;
        if (score > 0) log(`Score: ${c.value} = ${c.score} [${proofs.join(', ')}]`);
    }
}

module.exports = { computeScores };
