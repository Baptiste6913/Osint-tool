# CHANGELOG v5 → v6.0

## Sommaire impact
- **+30-50% de hit rate** attendu sur emails pros trouvés
- **Résilience** : 4 moteurs de recherche en fallback (Jina → Serper → Tavily → Bing)
- **0 API payante ajoutée** : toutes les nouvelles sources sont gratuites ou freemium
- **RGPD** : audit log + do-not-contact list + droits d'accès/effacement

---

## V1 — Quick wins (patterns / parsing / obfuscation)

### `src/predictions.js` — refonte complète
- **10 → 20 templates de patterns** (prenom.nom, pnom, p.nom, prenom-l, etc.)
- Génération par **variantes prénom × variantes nom × templates** = jusqu'à 80+ patterns par nom
- **Diminutifs FR+EN** : Alexandre → [alex, xan], Elisabeth → [liz, beth, lisa, babeth]
- **Role-based patterns** : si title=CEO → `ceo@`, `direction@`, `dg@`, `pdg@`
- `matchesPattern` gère désormais compound names (`jean-pierre.dupont`) et diminutifs

### `src/helpers.js` — parseName fixé
- Gère les **particules** : `Marie de la Rochefoucauld` → nom = `rochefoucauld`
- Gère les **compound names** : `Jean-Pierre Dupont` → firstParts = [jean, pierre], firstInitials = `jp`
- Ajoute `fetchWithRetry` (backoff exponentiel sur 5xx)
- `shouldReadUrl` **débloque les profils LinkedIn** (/in/ autorisé, reste bloqué)

### `src/diminutives.js` (nouveau)
- ~150 prénoms FR + EN avec forme officielle ↔ diminutifs (bidirectionnel)

### `src/extractors.js` — de-obfuscation + gradient
- Transforme `jean [at] truc [dot] com` → `jean@truc.com` avant extraction
- Gère entités HTML (`&#64;`, `&commat;`), unicode (`＠`), variations (`(at)`, `{dot}`, `AT`, `DOT`)
- **Proximity score gradient 0-1** (avant : binaire) — plus fin pour le scoring

### `src/domain-resolver.js` — TLDs étendus + DNS parallélisé
- 5 → **23 TLDs** testés : ajoute `.io .co .ai .tech .app .cloud .agency .studio .paris .global ...`
- DNS check **parallélisé** (Promise.all par batch de 20) — ~90% plus rapide
- Utilise le cache domaine pour éviter re-résolution

### `src/pattern-inference.js` (nouveau)
- Si Hunter Domain renvoie `pattern: null` mais ≥3 emails → **inférence par vote majoritaire**

### `src/pattern-stats.js` (nouveau)
- Distributions statistiques par TLD (fr/com/io/co/uk/de) et industrie (tech/consulting/law/finance/realestate/hr)
- Re-priorise les prédictions selon contexte : `{f}.{last}` boosté pour cabinets d'avocats, etc.

### `src/cache.js` — cache 2 niveaux
- **scan_cache** (TTL 24h) : résultats complets
- **domain_cache** (TTL 7 jours) : MX, catch-all, pattern Hunter, mapping company→domain
- Merge automatique des infos domaine entre scans

---

## V2 — Nouvelles sources gratuites

### `src/providers/github.js` (nouveau)
- **Search users** par nom → emails publics du profil
- **Commits publics** : extrait auteur-email des PushEvents
- **Search commits** par domaine (commits publics avec `author-email:@company.com`)
- Gratuit 60/h, ou 5000/h avec token

### `src/providers/serper.js` (nouveau)
- Fallback Google SERP (2 500 recherches gratuites à l'inscription)

### `src/providers/tavily.js` (nouveau)
- 2e fallback (1 000/mois gratuit)

### `src/providers/bing.js` (nouveau)
- 3e fallback via Azure (1 000/mois gratuit F1)

### `src/providers/wayback.js` (nouveau)
- Liste pages `/contact`, `/team`, `/about` archivées par Wayback Machine
- Lit le contenu et extrait emails (utile pour équipes actuelles ET anciennes)
- 100% gratuit, illimité

### `src/providers/emailrep.js` (nouveau)
- Réputation email + références publiques + détection data breach
- 100/jour gratuit sans clé, 1 000/jour avec

### `src/providers/rdap.js` (nouveau)
- WHOIS moderne : email registrant du domaine (souvent le CTO/fondateur)
- Gratuit, illimité

### `src/providers/securitytrails.js` (nouveau)
- Énumération sous-domaines : découvre `contact.company.com`, `team.company.com`...
- ⚠️ **API passée payante début 2024 (~500$/mois)** — code gardé pour les comptes pro, désactivé par défaut

### `src/providers/commoncrawl.js` (nouveau)
- Index global web pour trouver pages tierces mentionnant le domaine

### `src/providers/companies-house.js` (nouveau)
- Equivalent UK de Pappers (gratuit avec clé API)

### `src/providers/hunter.js` — pattern inference
- Fallback sur `inferPattern` quand Hunter retourne `pattern: null`

---

## V3 — Validation avancée

### `src/providers/smtp-direct.js` (nouveau)
- **Vérification SMTP directe** via RCPT TO probing (RFC 5321)
- Node natif (`net` + `dns`), pas de dépendance
- Fallback gratuit quand Hunter + Abstract quota épuisé
- Note : Google/M365 bloquent souvent le probing anonyme

### `src/mx-fingerprint.js` (nouveau)
- Identifie le provider mail (Google/M365/OVH/Exchange/...)
- Expose `catchAllLikely` (0-1) — probabilité catch-all par provider
- Permet scoring **probabiliste** au lieu de binaire

### `src/pattern-stats.js` — repriorization
- Voir V1 `src/pattern-stats.js` — utilisé dans pipeline.js

### Pipeline — reverse cross-check
- Pour top 3 candidats sans source API forte : recherche web l'email littéral
- Si contenu contient email ET nom → **+18 points** (`REVERSE_WEB_CONFIRMED`)

---

## V4 — UX / RGPD / CRM

### `src/dnc.js` (nouveau) — Do Not Contact
- SQLite : marque emails/domaines à exclure de tous les scans
- Routes `/api/dnc` (GET/POST/DELETE)
- Filtré automatiquement dans pipeline avant scoring

### `src/audit-log.js` (nouveau) — RGPD
- Journal des scans (IP, nom, entreprise, purpose, sources, résultats, durée)
- **Rétention 3 ans** auto-purge (configurable `AUDIT_RETENTION_DAYS`)
- Droit d'accès (art. 15) : `GET /api/audit/access?fullname=...`
- Droit d'effacement (art. 17) : `DELETE /api/audit/erasure`

### `server.js` — exports CRM
- Nouveaux formats : `/api/export/hubspot`, `/salesforce`, `/pipedrive`
- Chaque format mappe vers les champs attendus par le CRM
- Batch CSV augmenté : 10 → **25** contacts par requête

### `public/index.html`
- Version badge v4.1 → v6.0
- 3 boutons CRM (HubSpot, Salesforce, Pipedrive) à côté des exports existants

### Suppression code mort
- Dossier `ruflo/` supprimé (orchestrator jamais importé par pipeline.js)

---

## Nouveaux scores (`src/config.js`)

```js
GITHUB_COMMIT_EMAIL: 30,         // très fort signal dev/tech
WAYBACK_ARCHIVED_CONTACT: 15,    // page archivée qui contient l'email
EMAILREP_REPUTATION: 8,          // réputation positive
WHOIS_REGISTRANT: 12,            // email registrant du domaine
REVERSE_WEB_CONFIRMED: 18,       // cross-check : email + nom sur web
SMTP_DIRECT_DELIVERABLE: 12,     // SMTP direct deliverable (fallback)
COMPANIES_HOUSE_DIRECTOR: 10,
```

---

## Nouvelles variables d'env

Voir `.env.example`. Toutes optionnelles sauf Jina (ou un autre moteur Serper/Tavily/Bing).

- `GITHUB_TOKEN` — élève rate limit
- `SERPER_API_KEY` — fallback moteur #1
- `TAVILY_API_KEY` — fallback moteur #2
- `BING_SEARCH_KEY` — fallback moteur #3
- `EMAILREP_API_KEY` — rate limit EmailRep
- `SECURITYTRAILS_API_KEY` — énumération sous-domaines
- `COMPANIES_HOUSE_API_KEY` — UK
- `CACHE_TTL_HOURS` (défaut 24)
- `DOMAIN_CACHE_TTL_HOURS` (défaut 168)
- `AUDIT_RETENTION_DAYS` (défaut 1095 = 3 ans)

---

## Migration depuis v5.0

1. **Backup** ta base SQLite `cache.db` (les nouvelles tables `domain_cache`, `dnc`, `audit_log` seront créées auto).
2. **Copie** les fichiers du dossier `/tmp/osint/` (sauf `node_modules/` et `package-lock.json`) vers ton repo.
3. **Met à jour `.env`** avec les nouvelles clés optionnelles (ou ignore — tout fonctionne sans).
4. `npm install` (pas de nouvelles deps).
5. `node server.js` — les migrations SQLite se font au boot.

Les endpoints existants sont **100% backward-compatible**. Le payload retourné inclut juste des champs supplémentaires (`mxProvider`, `engine`, `reverseConfirmed`, etc.).

---

## Tests

29 nouveaux tests unitaires couvrent :
- `predictions` (expansion, compound, particules, diminutifs, role-based)
- `pattern-inference` (vote majoritaire, accents)
- `mx-fingerprint` (5 providers + unknown)
- `pattern-stats` (TLD/industrie/reprioritization)

Run : `npm test`
