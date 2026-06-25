// ================================================================
// MX FINGERPRINTING — Identifie le provider mail d'un domaine
// à partir des enregistrements MX. Permet un scoring catch-all
// probabiliste au lieu de binaire (Google/M365 rarement catch-all,
// Exchange/OVH plus souvent, etc.)
// ================================================================

const PROVIDERS = [
    { name: 'Google Workspace', pattern: /\b(google|googlemail|aspmx\.l\.google|googlehosted)\b/i, catchAllLikely: 0.05 },
    { name: 'Microsoft 365', pattern: /\b(outlook\.com|protection\.outlook|mail\.protection|microsoft-com\.mail|eo\.outlook)\b/i, catchAllLikely: 0.1 },
    { name: 'Zoho', pattern: /\bzoho\b/i, catchAllLikely: 0.15 },
    { name: 'FastMail', pattern: /\b(messagingengine|fastmail)\b/i, catchAllLikely: 0.1 },
    { name: 'ProtonMail', pattern: /\b(protonmail|proton\.ch|mail\.protonmail)\b/i, catchAllLikely: 0.2 },
    { name: 'iCloud', pattern: /\b(icloud|mac\.com|me\.com)\b/i, catchAllLikely: 0.05 },
    { name: 'OVH', pattern: /\b(ovh|mxplan)\b/i, catchAllLikely: 0.4 },
    { name: 'Infomaniak', pattern: /\binfomaniak\b/i, catchAllLikely: 0.3 },
    { name: 'Mailbox.org', pattern: /\bmailbox\.org\b/i, catchAllLikely: 0.2 },
    { name: 'Yandex', pattern: /\byandex\b/i, catchAllLikely: 0.1 },
    { name: 'ProofPoint', pattern: /\bpphosted\b/i, catchAllLikely: 0.3 },
    { name: 'MessageLabs/Symantec', pattern: /\bmessagelabs\b/i, catchAllLikely: 0.3 },
    { name: 'Mimecast', pattern: /\bmimecast\b/i, catchAllLikely: 0.3 },
    { name: 'Barracuda', pattern: /\bbarracudanetworks|barracuda\b/i, catchAllLikely: 0.3 },
    { name: 'Exchange on-prem', pattern: /\b(mail|mx|smtp|exchange|exch)\.\w+\.(com|fr|net|org)$/i, catchAllLikely: 0.5 },
];

function fingerprintMX(mxRecords) {
    if (!mxRecords || mxRecords.length === 0) return { provider: 'unknown', catchAllLikely: 0.3 };
    const joined = mxRecords.join(' ').toLowerCase();
    for (const p of PROVIDERS) {
        if (p.pattern.test(joined)) return { provider: p.name, catchAllLikely: p.catchAllLikely };
    }
    return { provider: 'unknown', catchAllLikely: 0.3 };
}

module.exports = { fingerprintMX, PROVIDERS };
