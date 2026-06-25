# OSINT Contact Finder v6.0

Recherche de contacts professionnels multi-sources avec vérification croisée et scoring basé sur preuves.

**Nouveautés v6** (détail complet dans [`CHANGELOG-v6.md`](./CHANGELOG-v6.md)) :
- **+30-50 % de hit rate** attendu sur les emails pros trouvés
- **Résilience** : 4 moteurs de recherche en fallback (Jina → Serper → Tavily → Bing)
- **Nouvelles sources gratuites** : GitHub (profils + commits publics), Wayback Machine, EmailRep, RDAP/WHOIS, Common Crawl, Companies House (UK)
- **Validation avancée** : vérification SMTP directe, fingerprint MX (probabilité catch-all), reverse cross-check web
- **RGPD** : audit log (rétention 3 ans), do-not-contact list, droits d'accès/effacement
- **Exports CRM** : HubSpot, Salesforce, Pipedrive
- **0 API payante ajoutée** — toutes les nouvelles sources sont gratuites ou freemium

---

## Prérequis

- **Node.js 18+** ([nodejs.org](https://nodejs.org)) — testé sous Node 24
- *(optionnel)* compilateur C++ pour `better-sqlite3` (cache, DNC et audit-log persistants)

## Installation

```bash
git clone https://github.com/Baptiste6913/Osint-tool.git
cd Osint-tool
npm install

# (optionnel) cache / do-not-contact / audit-log persistants
npm install better-sqlite3

cp .env.example .env   # puis renseigner au moins une clé moteur (voir ci-dessous)
```

> Sans `better-sqlite3`, le serveur démarre quand même : le cache, la DNC et l'audit-log
> sont simplement désactivés (dégradation gracieuse, aucune erreur bloquante).

## Configuration (`.env`)

Toutes les clés sont **optionnelles sauf au moins un moteur de recherche** (Jina, ou Serper / Tavily / Bing en fallback). Voir [`.env.example`](./.env.example) pour la liste complète et les liens d'inscription (offres gratuites/freemium).

| Variable | Rôle | Gratuit |
|---|---|---|
| `JINA_API_KEY` | Moteur de recherche principal | 10M tokens |
| `HUNTER_API_KEY` | Recherche + vérification email | 25+50/mois |
| `SERPER_API_KEY` / `TAVILY_API_KEY` / `BING_SEARCH_KEY` | Moteurs de fallback | oui |
| `GITHUB_TOKEN` | Élève le rate limit GitHub (60/h → 5000/h) | oui |
| `PAPPERS_API_KEY` | Données entreprises FR | 100 jetons |
| `PORT` | Port d'écoute (défaut `3000`) | — |

⚠️ **Ne committez jamais votre `.env`** — il est déjà dans `.gitignore`.

## Lancer

```bash
npm start          # = node server.js  →  http://localhost:3000
```

Au démarrage, un **health-check** affiche l'état et le quota de chaque source API.

## Tests

```bash
npm test           # = node --test tests/
```

---

## API

| Méthode | Endpoint | Description |
|---|---|---|
| `GET`  | `/api/status` | État du service |
| `GET`  | `/api/health` | Health-check des sources API + quotas |
| `POST` | `/api/scan` | Scan complet d'un contact |
| `POST` | `/api/scan/quick` | Scan rapide |
| `POST` | `/api/scan/batch` | Scan par lot (jusqu'à 25 contacts) |
| `GET`  | `/api/export/:format` | Export `csv`, `hubspot`, `salesforce`, `pipedrive` |
| `GET/POST/DELETE` | `/api/dnc` | Do-Not-Contact list |
| `GET`  | `/api/audit` · `/api/audit/access` | Journal RGPD / droit d'accès |
| `DELETE` | `/api/audit/erasure` | Droit d'effacement (RGPD art. 17) |
| `GET`  | `/api/cache/stats` · `/api/cache/clear` | Cache |

---

## Déploiement

Application Express standard, prête pour tout PaaS (Render, Railway, Clever Cloud, Heroku…) :

- **Commande de build** : `npm install`
- **Commande de démarrage** : `npm start`
- Le serveur écoute sur `0.0.0.0` et respecte la variable d'environnement **`PORT`**
- Renseigner les clés API du `.env` en **variables d'environnement** de la plateforme (ne pas committer le `.env`)
- Pour le cache/DNC/audit-log persistants, ajouter `better-sqlite3` aux dépendances et prévoir un volume pour le fichier `cache.db`

---

## Licence

Usage interne. Respecter les CGU des sources interrogées et le RGPD lors de toute collecte de données personnelles.
