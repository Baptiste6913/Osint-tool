// ================================================================
// API: GITHUB — Recherche utilisateurs + extraction emails depuis commits publics
// Sans token : 60 req/h. Avec token : 5000 req/h. Token optionnel.
// ================================================================
const { fetchWithRetry, isQuotaError, log } = require('../helpers');
const { KEYS, TIMEOUTS } = require('../config');

function authHeaders() {
    const h = { 'Accept': 'application/vnd.github+json', 'User-Agent': 'osint-contact-finder' };
    if (KEYS.github) h['Authorization'] = `Bearer ${KEYS.github}`;
    return h;
}

// Search users by name + extract email from public profile
async function githubFindUser(name, companyName, exhausted) {
    if (exhausted && exhausted.has('github')) return null;
    try {
        const q = encodeURIComponent(`"${name.firstOg} ${name.lastOg}" in:fullname`);
        const r = await fetchWithRetry(
            `https://api.github.com/search/users?q=${q}&per_page=10`,
            { headers: authHeaders() }, TIMEOUTS.GITHUB
        );
        if (isQuotaError(r.status, '')) {
            if (exhausted) exhausted.add('github');
            return { _quotaExceeded: true };
        }
        if (!r.ok) return null;
        const data = await r.json();
        const users = data.items || [];

        // Fetch user details (email public si dispo) + filtrer par nom/company
        const candidates = [];
        const maxFetch = Math.min(users.length, 5);
        const companyLower = (companyName || '').toLowerCase();
        for (let i = 0; i < maxFetch; i++) {
            const u = users[i];
            try {
                const ur = await fetchWithRetry(u.url, { headers: authHeaders() }, TIMEOUTS.GITHUB);
                if (!ur.ok) continue;
                const udata = await ur.json();
                const matchesName = (udata.name || '').toLowerCase().includes(name.firstOg.toLowerCase())
                    && (udata.name || '').toLowerCase().includes(name.lastOg.toLowerCase().split(' ')[0]);
                const matchesCompany = companyLower && (udata.company || '').toLowerCase().includes(companyLower.split(' ')[0]);
                if (udata.email && (matchesName || matchesCompany)) {
                    candidates.push({ email: udata.email, login: udata.login, name: udata.name, company: udata.company });
                }
                // Si on a un bon match par nom mais pas d'email public : essayer les commits
                if (matchesName && !udata.email) {
                    const commitEmails = await fetchCommitsEmails(udata.login);
                    for (const ce of commitEmails) {
                        candidates.push({ email: ce, login: udata.login, name: udata.name, source: 'commits' });
                    }
                }
            } catch (e) { log(`GitHub user detail error: ${e.message}`); }
        }
        return { users: candidates };
    } catch (e) { log(`GitHub error: ${e.message}`); }
    return null;
}

// Récupère les emails depuis les commits publics d'un user
// (git commits contiennent author email)
async function fetchCommitsEmails(login) {
    const emails = new Set();
    try {
        const r = await fetchWithRetry(
            `https://api.github.com/users/${encodeURIComponent(login)}/events/public?per_page=30`,
            { headers: authHeaders() }, TIMEOUTS.GITHUB
        );
        if (!r.ok) return [];
        const events = await r.json();
        for (const ev of events) {
            if (ev.type === 'PushEvent' && ev.payload?.commits) {
                for (const commit of ev.payload.commits) {
                    if (commit.author?.email) {
                        const em = commit.author.email.toLowerCase();
                        // Filtrer les emails noreply GitHub
                        if (!em.includes('users.noreply.github.com') && !em.includes('noreply.github.com')) {
                            emails.add(em);
                        }
                    }
                }
            }
        }
    } catch (e) { log(`GitHub commits error for ${login}: ${e.message}`); }
    return [...emails];
}

// Search commits across GitHub pour emails liés à un domaine
async function githubSearchCommitsByDomain(domain, exhausted) {
    if (exhausted && exhausted.has('github')) return [];
    try {
        const q = encodeURIComponent(`author-email:"@${domain}"`);
        const r = await fetchWithRetry(
            `https://api.github.com/search/commits?q=${q}&per_page=20`,
            {
                headers: {
                    ...authHeaders(),
                    'Accept': 'application/vnd.github.cloak-preview',
                },
            }, TIMEOUTS.GITHUB
        );
        if (isQuotaError(r.status, '')) {
            if (exhausted) exhausted.add('github');
            return [];
        }
        if (!r.ok) return [];
        const data = await r.json();
        const out = [];
        for (const item of (data.items || [])) {
            const em = item.commit?.author?.email;
            const nm = item.commit?.author?.name;
            if (em && em.endsWith('@' + domain)) {
                out.push({ email: em, name: nm, source: 'commit' });
            }
        }
        return out;
    } catch (e) { log(`GitHub commit search error: ${e.message}`); }
    return [];
}

module.exports = { githubFindUser, fetchCommitsEmails, githubSearchCommitsByDomain };
