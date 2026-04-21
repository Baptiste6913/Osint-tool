// ================================================================
// EXTRACTORS — Extraction contextuelle de contacts depuis du texte
// ================================================================
const { normalize } = require('./helpers');

function extractContactsContextual(text, source, fullname, domain) {
    const results = [];
    const textNorm = normalize(text);
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

    const EMAIL_WINDOW = 400;
    const PHONE_WINDOW = 800;
    function isNearNameEmail(mi) { return namePositions.length > 0 && namePositions.some(np => Math.abs(mi - np.pos) < EMAIL_WINDOW); }
    function isNearNamePhone(mi) { return namePositions.length > 0 && namePositions.some(np => Math.abs(mi - np.pos) < PHONE_WINDOW); }
    function isNearNameProfile(mi) { return namePositions.length > 0 && namePositions.some(np => Math.abs(mi - np.pos) < EMAIL_WINDOW); }

    const emailRx = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;
    const blacklistExt = /\.(png|jpg|jpeg|gif|svg|css|js|woff|ttf|ico|webp)$/i;
    const fakeDomains = ['example.com', 'email.com', 'domain.com', 'test.com', 'placeholder.com', 'sentry.io'];
    const genericLocalParts = new Set(['noreply','no-reply','mailer-daemon','postmaster','abuse','webmaster','info','contact','support','admin','hello','privacy','legal','security','billing','sales','newsletter','unsubscribe','marketing','press','media','hr','jobs','careers','feedback','office','team','general','enquiries','service','help','assistance']);

    let m;
    while ((m = emailRx.exec(text)) !== null) {
        const email = m[0].toLowerCase();
        if (blacklistExt.test(email)) continue;
        if (fakeDomains.some(d => email.endsWith('@' + d))) continue;
        if (email.length > 60 || email.length < 6) continue;
        const localPart = email.split('@')[0];
        const isGeneric = genericLocalParts.has(localPart);
        results.push({ value: email, type: 'email', source, proximity: isNearNameEmail(m.index), isDomainMatch: email.endsWith('@' + domain), isGeneric });
    }

    const phonePatterns = [
        /(?:\+33|0033)[\s.\-]?[1-9](?:[\s.\-]?\d{2}){4}/g,
        /\b0[1-9](?:[\s.\-]?\d{2}){4}\b/g,
        /(?:\+\d{1,3})[\s.\-]?\(?\d{1,4}\)?(?:[\s.\-]\d{2,4}){2,4}/g,
    ];
    for (const rx of phonePatterns) {
        rx.lastIndex = 0;
        while ((m = rx.exec(text)) !== null) {
            const raw = m[0].trim();
            const digits = raw.replace(/\D/g, '');
            if (digits.length < 10 || digits.length > 15) continue;
            if (/^(19|20)\d{6,}$/.test(digits) && !digits.startsWith('33')) continue;
            let display = raw;
            if (/^0[1-9]\d{8}$/.test(digits)) display = digits.replace(/(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/, '$1 $2 $3 $4 $5');
            results.push({ value: display, type: 'phone', source, proximity: isNearNamePhone(m.index), isDomainMatch: false, isGeneric: false });
        }
    }

    const linkedinRx = /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\/([A-Za-z0-9\-_%]+)/g;
    while ((m = linkedinRx.exec(text)) !== null) {
        const profileSlug = decodeURIComponent(m[1]).toLowerCase().replace(/[^a-z]/g, '');
        // Filtrer : ne garder que les profils dont l'URL contient le nom ou prenom
        const hasFirstName = firstName.length > 2 && profileSlug.includes(firstName.replace(/[^a-z]/g, ''));
        const hasLastName = lastName.length > 2 && profileSlug.includes(lastName.split(' ')[0].replace(/[^a-z]/g, ''));
        if (hasFirstName || hasLastName) {
            results.push({ value: m[0], type: 'linkedin', source, proximity: isNearNameProfile(m.index), isDomainMatch: false, isGeneric: false });
        }
    }

    const twitterRx = /https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/[A-Za-z0-9_]{1,30}/g;
    while ((m = twitterRx.exec(text)) !== null) {
        if (!/\/(search|hashtag|i|home|explore|settings|login|signup)$/i.test(m[0]))
            results.push({ value: m[0], type: 'twitter', source, proximity: isNearNameProfile(m.index), isDomainMatch: false, isGeneric: false });
    }
    return results;
}

module.exports = { extractContactsContextual };
