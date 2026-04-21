// ================================================================
// DORKS — Generation de Google Dorks
// ================================================================

function generateDorks(fullname, company, domain) {
    const qn = `"${fullname}"`, qc = `"${company}"`;
    return [
        { cat: 'LinkedIn', icon: '\ud83d\udcbc', queries: [{ l: 'Profil', q: `site:linkedin.com/in ${qn} ${qc}` }, { l: 'Contact', q: `site:linkedin.com ${qn} "email" OR "phone"` }] },
        { cat: 'Email', icon: '\u2709\ufe0f', queries: [{ l: 'Email @domaine', q: `"@${domain}" ${qn}` }, { l: 'Contact', q: `${qn} ${qc} "email" OR "contact" OR "telephone"` }] },
        { cat: 'Reseaux', icon: '\ud83c\udf10', queries: [{ l: 'Twitter/X', q: `site:twitter.com OR site:x.com ${qn} ${qc}` }, { l: 'GitHub', q: `site:github.com ${qn}` }] },
        { cat: 'Annuaires', icon: '\ud83d\udcd6', queries: [{ l: 'Societe.com', q: `site:societe.com ${qc} ${qn}` }, { l: 'Site', q: `site:${domain} "team" OR "equipe" OR "contact" ${qn}` }] },
        { cat: 'Documents', icon: '\ud83d\udcc4', queries: [{ l: 'PDF', q: `filetype:pdf ${qn} ${qc} "email"` }, { l: 'Fichiers', q: `filetype:xlsx OR filetype:csv ${qn} "@${domain}"` }] },
    ];
}

module.exports = { generateDorks };
