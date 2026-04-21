# OSINT Contact Finder v4

Recherche de contacts professionnels multi-sources avec v&eacute;rification crois&eacute;e.

8 sources de donn&eacute;es, v&eacute;rification SMTP double, scoring bas&eacute; sur preuves, z&eacute;ro faux positif.

## Pr&eacute;requis

- **Node.js 18+** ([nodejs.org](https://nodejs.org))

## Installation rapide

```bash
cd osint-v4
npm install
cp .env.example .env
# &Eacute;diter .env avec vos cl&eacute;s API (voir ci-dessous)
node server.js
# Ouvrir http://localhost:3000
```

## Configuration des cl&eacute;s API

&Eacute;ditez le fichier `.env` avec vos cl&eacute;s. Seule **Jina AI** est obligatoire. Plus vous ajoutez de cl&eacute;s, plus les r&eacute;sultats sont fiables et crois&eacute;s.

### Jina AI (REQUIS)

1. Allez sur [jina.ai](https://jina.ai/?sui=apikey)
2. Pas besoin de cr&eacute;er un compte
3. Cliquez "API" puis "API KEY & BILLING"
4. Copiez la cl&eacute; `jina_xxx...`
5. Collez dans `.env` : `JINA_API_KEY=jina_xxx...`

### Hunter.io (RECOMMAND&Eacute;)

1. Cr&eacute;ez un compte sur [hunter.io/users/sign_up](https://hunter.io/users/sign_up)
2. Allez dans Account Settings → API
3. Copiez votre cl&eacute; API
4. Collez dans `.env` : `HUNTER_API_KEY=votre_cle`

### Snov.io (OPTIONNEL)

1. Cr&eacute;ez un compte sur [app.snov.io/register](https://app.snov.io/register)
2. Allez sur [app.snov.io/api-setting](https://app.snov.io/api-setting)
3. Copiez le Client ID et le Client Secret
4. Collez dans `.env` :
   ```
   SNOV_CLIENT_ID=votre_id
   SNOV_CLIENT_SECRET=votre_secret
   ```

### Apollo.io (OPTIONNEL)

1. Cr&eacute;ez un compte sur [apollo.io/sign-up](https://www.apollo.io/sign-up)
2. Allez dans Settings → Integrations → API
3. Copiez votre cl&eacute; API
4. Collez dans `.env` : `APOLLO_API_KEY=votre_cle`

### Pappers.fr (OPTIONNEL &mdash; tr&egrave;s utile pour les entreprises fran&ccedil;aises)

1. Allez sur [pappers.fr/api](https://www.pappers.fr/api)
2. Cr&eacute;ez un compte (email professionnel recommand&eacute;)
3. Depuis votre espace membre, activez la cl&eacute; API
4. Copiez le token
5. Collez dans `.env` : `PAPPERS_API_KEY=votre_token`

### Abstract API (OPTIONNEL)

1. Cr&eacute;ez un compte sur [abstractapi.com](https://www.abstractapi.com/api/email-verification-validation-api)
2. Allez dans Dashboard → Email Validation
3. Copiez votre cl&eacute; API
4. Collez dans `.env` : `ABSTRACT_API_KEY=votre_cle`

## Tableau des APIs

| API | Gratuit | Cl&eacute; requise | Impact sur les r&eacute;sultats |
|-----|---------|------------|-------------------------------|
| **Jina AI** | 10M tokens | **Oui (obligatoire)** | Recherche web + lecture pages |
| **Hunter.io** | 25 recherches + 50 v&eacute;rifs/mois | Recommand&eacute; | Email finder + v&eacute;rification deliverability |
| **Snov.io** | 50 cr&eacute;dits/mois | Optionnel | Source alternative d'emails |
| **Apollo.io** | 50 cr&eacute;dits/mois | Optionnel | Plus grosse base B2B mondiale (275M contacts) |
| **Pappers.fr** | 100 cr&eacute;dits | Optionnel | R&eacute;solution du vrai domaine + dirigeants (FR) |
| **Abstract API** | 100 v&eacute;rifs/mois | Optionnel | Double v&eacute;rification SMTP ind&eacute;pendante |
| **dns.google** | Illimit&eacute; | Non | V&eacute;rification MX |
| **Gravatar** | Illimit&eacute; | Non | Signal d'existence d'un email |

## Fonctionnement

1. **Pappers.fr** r&eacute;sout le vrai domaine de l'entreprise (pour les soci&eacute;t&eacute;s FR)
2. **R&eacute;solution domaine** par recherche Jina + test MX sur TLDs courants
3. **V&eacute;rification MX** du domaine via dns.google
4. **APIs email finder** en parall&egrave;le : Hunter + Snov + Apollo
5. **Recherches web** Jina AI (7 requ&ecirc;tes cibl&eacute;es par lots de 3)
6. **Lecture des pages** cl&eacute;s du site (contact, team, about...)
7. **Pr&eacute;dictions email** par patterns (prenom.nom, p.nom, etc.)
8. **V&eacute;rification batch** : Gravatar + Hunter verify + Abstract API
9. **Scoring** bas&eacute; sur preuves, affichage par niveau de confiance

### Niveaux de confiance

- **V&eacute;rifi&eacute; (80+)** : Cross-valid&eacute; par 2+ sources ind&eacute;pendantes
- **Probable (50-79)** : Trouv&eacute; par une source fiable avec v&eacute;rification partielle
- **Non v&eacute;rifi&eacute; (<50)** : Trouv&eacute; mais pas assez de preuves
- **&Eacute;limin&eacute;** : Invalide, g&eacute;n&eacute;rique, ou domaine MX mort

## Licence

Usage professionnel. Respectez la l&eacute;gislation en vigueur (RGPD, CNIL).
