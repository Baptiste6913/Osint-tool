// ================================================================
// EXTRACTORS — Extraction contextuelle de contacts depuis du texte
// + de-obfuscation ([at] (at) [dot] ...) + gradient proximité
// ================================================================
const { normalize } = require('./helpers');

// ================================================================
// De-obfuscation : transforme "jean [at] truc [dot] com" → "jean@truc.com"
// avant extraction. Conserve le texte d'origine pour les positions via
// offset mapping (simplification : on extrait du texte désobfusqué).
// ================================================================
function deobfuscate(text) {
    return text
        // @ variations
        .replace(/\s*(?:\[|\(|\{)\s*(?:at|AT|At|arobase|chez)\s*(?:\]|\)|\})\s*/g, '@')
        .replace(/\s+(?:at|AT|At)\s+/g, '@')
        .replace(/\s*＠\s*/g, '@')         // unicode fullwidth @
        .replace(/&#64;/g, '@')
        .replace(/&commat;/gi, '@')
        // . variations (uniquement près d'un domaine apparent — on le fait large)
        .replace(/\s*(?:\[|\(|\{)\s*(?:dot|DOT|Dot|point)\s*(?:\]|\)|\})\s*/g, '.')
        .replace(/(\w)\s+(?:dot|DOT|Dot)\s+(\w{2,})/g, '$1.$2')
        .replace(/&#46;/g, '.')
        .replace(/&period;/gi, '.');
}

// ================================================================
// Proximity gradient : plus l'email est proche du nom, plus le score
// de confiance est élevé. Retourne 0-1.
// ================================================================
function proximityScore(matchIdx, namePositions) {
    if (!namePositions || namePositions.length === 0) return 0;
    const minDist = Math.min(...namePositions.map(np => Math.abs(matchIdx - np.pos)));
    if (minDist < 100) return 1.0;
    if (minDist < 300) return 0.7;
    if (minDist < 600) return 0.4;
    if (minDist < 1200) return 0.15;
    return 0;
}

function extractContactsContextual(text, source, fullname, domain) {
    const results = [];
    // De-obfuscate d'abord
    const textDeobf = deobfuscate(text);
    const textNorm = normalize(textDeobf);
    const nameNorm = normalize(fullname);
    const nameParts = nameNorm.split(/\s+/).filter(p => p.length > 2);
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    const namePositions = [];
    const searchVariants = [nameNorm];
    if (firstName && lastName) {
        searchVariants.push(firstName + ' ' + lastName, lastName + ' ' + firstName);
        if (lastName.length > 2) searchVariants.push(lastName);
    }
    for (const variant of searchVariants) {
        let idx = textNorm.indexOf(variant);
        while (idx !== -1) { namePositions.push({ pos: idx }); idx = textNorm.indexOf(variant, idx + 1); }
    }

    const emailRx = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;
    const blacklistExt = /\.(png|jpg|jpeg|gif|svg|css|js|woff|ttf|ico|webp)$/i;
    const fakeDomains = ['example.com', 'email.com', 'domain.com', 'test.com', 'placeholder.com', 'sentry.io'];
    const genericLocalParts = new Set(['noreply','no-reply','mailer-daemon','postmaster','abuse','webmaster','info','contact','support','admin','hello','privacy','legal','security','billing','sales','newsletter','unsubscribe','marketing','press','media','hr','jobs','careers','feedback','office','team','general','enquiries','service','help','assistance']);

    let m;
    while ((m = emailRx.exec(textDeobf)) !== null) {
        const email = m[0].toLowerCase();
        if (blacklistExt.test(email)) continue;
        if (fakeDomains.some(d => email.endsWith('@' + d))) continue;
        if (email.length > 60 || email.length < 6) continue;
        const localPart = email.split('@')[0];
        const isGeneric = genericLocalParts.has(localPart);
        const prox = proximityScore(m.index, namePositions);
        results.push({
            value: email, type: 'email', source,
            proximity: prox > 0.3,          // binaire backward compat
            proximityScore: prox,            // gradient 0-1
            isDomainMatch: email.endsWith('@' + domain),
            isGeneric
        });
    }

    const phonePatterns = [
        /(?:\+33|0033)[\s.\-]?[1-9](?:[\s.\-]?\d{2}){4}/g,
        /\b0[1-9](?:[\s.\-]?\d{2}){4}\b/g,
        /(?:\+\d{1,3})[\s.\-]?\(?\d{1,4}\)?(?:[\s.\-]\d{2,4}){2,4}/g,
    ];
    for (const rx of phonePatterns) {
        rx.lastIndex = 0;
        while ((m = rx.exec(textDeobf)) !== null) {
            const raw = m[0].trim();
            const digits = raw.replace(/\D/g, '');
            if (digits.length < 10 || digits.length > 15) continue;
            if (/^(19|20)\d{6,}$/.test(digits) && !digits.startsWith('33')) continue;
            let display = raw;
            if (/^0[1-9]\d{8}$/.test(digits)) display = digits.replace(/(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/, '$1 $2 $3 $4 $5');
            const prox = proximityScore(m.index, namePositions);
            results.push({
                value: display, type: 'phone', source,
                proximity: prox > 0.15,     // tél : fenêtre plus large
                proximityScore: prox,
                isDomainMatch: false, isGeneric: false
            });
        }
    }

    const linkedinRx = /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\/([A-Za-z0-9\-_%]+)/g;
    while ((m = linkedinRx.exec(textDeobf)) !== null) {
        const profileSlug = decodeURIComponent(m[1]).toLowerCase().replace(/[^a-z]/g, '');
        const hasFirstName = firstName.length > 2 && profileSlug.includes(firstName.replace(/[^a-z]/g, ''));
        const hasLastName = lastName.length > 2 && profileSlug.includes(lastName.split(' ')[0].replace(/[^a-z]/g, ''));
        if (hasFirstName || hasLastName) {
            const prox = proximityScore(m.index, namePositions);
            results.push({ value: m[0], type: 'linkedin', source, proximity: prox > 0.3, proximityScore: prox, isDomainMatch: false, isGeneric: false });
        }
    }

    const twitterRx = /https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/[A-Za-z0-9_]{1,30}/g;
    while ((m = twitterRx.exec(textDeobf)) !== null) {
        if (!/\/(search|hashtag|i|home|explore|settings|login|signup)$/i.test(m[0])) {
            const prox = proximityScore(m.index, namePositions);
            results.push({ value: m[0], type: 'twitter', source, proximity: prox > 0.3, proximityScore: prox, isDomainMatch: false, isGeneric: false });
        }
    }
    return results;
}

module.exports = { extractContactsContextual, deobfuscate, proximityScore };
