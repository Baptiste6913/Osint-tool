# Migration v5 → v6.0 — Guide rapide

## TL;DR
Copie les fichiers, garde ton `.env` actuel, `npm install`, démarre. Rien ne casse.

## 1. Fichiers modifiés (copie/écrase)
```
package.json                      ← version bump
.env.example                      ← nouvelles clés documentées
server.js                         ← routes DNC, audit, CRM exports
public/index.html                 ← boutons CRM, version v6.0

src/helpers.js                    ← parseName fixé, fetchWithRetry, LinkedIn /in/
src/predictions.js                ← refonte 45+ patterns, diminutifs, role-based
src/extractors.js                 ← de-obfuscation, gradient proximité
src/domain-resolver.js            ← TLDs étendus, DNS parallélisé
src/cache.js                      ← 2 namespaces (scan + domain)
src/candidates.js                 ← nouveaux champs (smtpDirect, emailRep, reverseConfirmed, githubLogin)
src/scoring.js                    ← nouveaux scores v6
src/pipeline.js                   ← wire-up complet des nouveaux providers
src/health-check.js               ← checks pour nouvelles APIs
src/config.js                     ← nouvelles KEYS, SCORING, TIMEOUTS
src/providers/hunter.js           ← pattern inference fallback
```

## 2. Fichiers nouveaux (copie)
```
src/diminutives.js
src/pattern-inference.js
src/pattern-stats.js
src/mx-fingerprint.js
src/dnc.js
src/audit-log.js

src/providers/github.js
src/providers/serper.js
src/providers/tavily.js
src/providers/bing.js
src/providers/wayback.js
src/providers/emailrep.js
src/providers/rdap.js
src/providers/securitytrails.js
src/providers/commoncrawl.js
src/providers/companies-house.js
src/providers/smtp-direct.js

tests/predictions.test.js
tests/pattern-inference.test.js
tests/mx-fingerprint.test.js
tests/pattern-stats.test.js

CHANGELOG-v6.md
MIGRATION.md
```

## 3. Fichiers supprimés
```
ruflo/                             ← code mort (orchestrator jamais importé)
```

## 4. Clés API à ajouter (TOUTES optionnelles)

Priorité d'ajout selon impact :

| Rang | Clé | Pourquoi | Coût | Lien |
|------|-----|----------|------|------|
| 1 | `SERPER_API_KEY` | Jina parfois down → SPOF | 2500 free | serper.dev |
| 2 | `GITHUB_TOKEN` | Énorme pour dev/tech targets | Gratuit | github.com/settings/tokens |
| 3 | `EMAILREP_API_KEY` | 2e vérif + réputation | 1000/j free | emailrep.io |
| 4 | `TAVILY_API_KEY` | 2e fallback moteur | 1000/mois free | tavily.com |
| ~~5~~ | ~~`SECURITYTRAILS_API_KEY`~~ | Sous-domaines | ~~50/mois~~ **payant uniquement (~500$/mois)** | skip |
| 6 | `COMPANIES_HOUSE_API_KEY` | Si tu prospectes UK | Gratuit | developer.company-information.service.gov.uk |
| 7 | `BING_SEARCH_KEY` | 3e fallback | 1000/mois | portal.azure.com |

Sans aucune nouvelle clé, tu gagnes déjà :
- Patterns étendus (42 → 80+ au lieu de 10)
- Diminutifs / particules / compound names
- De-obfuscation
- TLDs étendus + DNS parallèle
- MX fingerprinting
- Pattern inference Hunter
- Stats-aware repriorization
- SMTP direct (gratuit, pas de clé)
- GitHub (60/h sans token)
- EmailRep (100/j sans clé)
- Wayback Machine (gratuit illimité)
- RDAP WHOIS (gratuit illimité)
- Cache domaine 7 jours

## 5. Commandes

```bash
# Test des modules purs (sans deps externes)
node --test tests/predictions.test.js tests/pattern-inference.test.js tests/mx-fingerprint.test.js tests/pattern-stats.test.js

# Test complet
npm test

# Démarrage
node server.js
# → http://localhost:3000
```

## 6. Nouveaux endpoints

```
GET    /api/dnc                          Liste DNC
POST   /api/dnc                          Ajouter {value, type, reason}
DELETE /api/dnc/:value                   Retirer
GET    /api/dnc/check/:value             Vérifier

GET    /api/audit?fullname=&company=     Query log
GET    /api/audit/access?fullname=       Droit d'accès RGPD art.15
DELETE /api/audit/erasure                Droit d'effacement RGPD art.17 (body: {fullname})

GET    /api/export/hubspot?data=<b64>    Export HubSpot
GET    /api/export/salesforce?data=<b64> Export Salesforce
GET    /api/export/pipedrive?data=<b64>  Export Pipedrive
```

## 7. Quoi tester après migration

1. `node server.js` démarre → tableau health-check affiche OK pour tes APIs existantes
2. Scan d'un contact connu → payload contient `apolloTitle`, `mxProvider`, `engine`, `catchAllPrior`
3. Les prédictions du payload sont plus nombreuses (20+ au lieu de 10)
4. Bouton HubSpot/Salesforce/Pipedrive téléchargent bien un CSV
5. `GET /api/dnc` retourne `{entries: []}` (vide au début)
6. `GET /api/cache/stats` retourne `{scanEntries, domainEntries, ...}`
