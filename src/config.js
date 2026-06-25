// ================================================================
// CONFIG — Clés, constantes scoring, timeouts
// ================================================================
require('dotenv').config();

const KEYS = {
    // v5.0
    jina: process.env.JINA_API_KEY || '',
    hunter: process.env.HUNTER_API_KEY || '',
    snovId: process.env.SNOV_CLIENT_ID || '',
    snovSecret: process.env.SNOV_CLIENT_SECRET || '',
    apollo: process.env.APOLLO_API_KEY || '',
    pappers: process.env.PAPPERS_API_KEY || '',
    abstract: process.env.ABSTRACT_API_KEY || '',
    // v6.0 — nouvelles sources
    github: process.env.GITHUB_TOKEN || '',          // optionnel (augmente rate limit 60→5000/h)
    serper: process.env.SERPER_API_KEY || '',        // fallback moteur de recherche (2500/mois free)
    tavily: process.env.TAVILY_API_KEY || '',        // 2e fallback search
    bing: process.env.BING_SEARCH_KEY || '',         // 3e fallback search
    emailrep: process.env.EMAILREP_API_KEY || '',    // 100/jour free sans clé, 1000/jour avec
    securitytrails: process.env.SECURITYTRAILS_API_KEY || '', // subdomain enum, 50/mois
    companieshouse: process.env.COMPANIES_HOUSE_API_KEY || '', // UK, gratuit
};

const SCORING = {
    // v5.0
    HUNTER_FINDER: 25,
    APOLLO_FOUND: 25,
    SNOV_FOUND: 20,
    HUNTER_DOMAIN: 10,
    WEB_PROXIMITY: 15,
    PAPPERS_DIRECTOR: 10,
    MATCHES_HUNTER_PATTERN: 10,
    DOMAIN_MATCH: 5,
    SMTP_VALID_NON_CATCHALL: 15,
    SMTP_VALID_CATCHALL: 0,
    ABSTRACT_DELIVERABLE: 10,
    GRAVATAR_EXISTS: 3,
    TWO_INDEPENDENT_SOURCES: 20,
    THREE_INDEPENDENT_SOURCES: 35,
    APOLLO_HAS_TITLE: 5,
    APOLLO_HAS_LINKEDIN: 5,
    GENERIC_EMAIL: -40,
    NO_PROXIMITY_NO_API: -30,
    MX_INVALID: -999,
    SMTP_INVALID_NON_CATCHALL: -999,
    // v6.0 — nouveaux scores
    GITHUB_COMMIT_EMAIL: 30,            // email trouvé dans commits publics = très fort
    WAYBACK_ARCHIVED_CONTACT: 15,       // page archivée qui contient l'email
    EMAILREP_REPUTATION: 8,              // réputation positive
    WHOIS_REGISTRANT: 12,                // email registrant du domaine
    REVERSE_WEB_CONFIRMED: 18,           // cross-check web trouve email+nom ensemble
    SMTP_DIRECT_DELIVERABLE: 12,         // SMTP probing direct
    COMPANIES_HOUSE_DIRECTOR: 10,
};

const TIMEOUTS = {
    HUNTER: 12000,
    APOLLO: 15000,
    SNOV: 12000,
    PAPPERS: 8000,
    ABSTRACT: 12000,
    JINA_SEARCH: 20000,
    JINA_READ: 10000,
    GRAVATAR: 5000,
    DNS: 8000,
    API_PARALLEL: 20000,
    // v6.0
    GITHUB: 10000,
    SERPER: 10000,
    TAVILY: 10000,
    BING: 10000,
    EMAILREP: 8000,
    RDAP: 6000,
    WAYBACK: 15000,
    SECURITYTRAILS: 10000,
    SMTP_DIRECT: 10000,
    COMPANIES_HOUSE: 8000,
};

const GENERIC_LOCAL_PARTS = new Set([
    'contact', 'info', 'support', 'admin', 'hello', 'sales', 'marketing',
    'press', 'hr', 'jobs', 'team', 'office', 'general', 'service', 'help',
    'noreply', 'no-reply', 'postmaster', 'abuse', 'webmaster', 'privacy',
    'legal', 'security', 'billing', 'newsletter', 'unsubscribe', 'media',
    'careers', 'feedback', 'enquiries', 'assistance',
    'observatoire', 'information', 'secretariat', 'secretariatbranche',
    'hautsdefrance', 'bretagne', 'iledefrance', 'occitanie',
    'bourgognefranchecomte', 'nouvelle-aquitaine', 'normandie',
    'grandest', 'paysdelaloire', 'centrevaldeloire', 'paca',
    'auvergne', 'auvergnerhonaealpes',
]);

const BLOCKED_READER_DOMAINS = [
    'contactout.com', 'rocketreach.co', 'lusha.com', 'signalhire.com',
    'zoominfo.com', 'leadiq.com', 'kaspr.io', 'apollo.io', 'snov.io',
    'hunter.io', 'clearbit.com', 'skrapp.io', 'anymailfinder.com',
    // LinkedIn : partiellement débloqué dans helpers.shouldReadUrl (profils /in/ autorisés)
    'facebook.com', 'twitter.com', 'x.com',
];

const AGGREGATOR_DOMAINS = [
    'pappers.fr', 'societe.com', 'verif.com', 'linkedin.com', 'pagesjaunes.fr',
    'google.com', 'google.fr', 'wikipedia.org', 'facebook.com', 'twitter.com', 'x.com',
    'indeed.com', 'glassdoor.fr', 'welcometothejungle.com', 'annuaire.com',
];

let snovTokenCache = { token: null, expiresAt: 0 };

module.exports = {
    KEYS, SCORING, TIMEOUTS, GENERIC_LOCAL_PARTS,
    BLOCKED_READER_DOMAINS, AGGREGATOR_DOMAINS,
    snovTokenCache,
};
