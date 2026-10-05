# OSINT Contact Finder

A Node.js service that finds and scores the professional email address, phone number, and LinkedIn profile of a named person at a given company, using public sources and third-party APIs.

## Run it

Requires Node.js 18 or later.

```bash
npm install
cp .env.example .env    # set at least one search engine key
npm start               # http://localhost:3000
```

`better-sqlite3` is an optional dependency. Without it the server still starts, with the cache, do-not-contact list, and audit log disabled.

Run the tests:

```bash
npm test
```

Start a scan from the browser UI, or call the API directly. The response is a server-sent event stream.

```bash
curl -N -X POST http://localhost:3000/api/scan \
  -H "Content-Type: application/json" \
  -d '{"fullname":"Jane Doe","company":"example.com"}'
```

## Architecture

- `server.js`: Express app. It serves `public/index.html` and exposes scan, batch (up to 25 contacts), export, do-not-contact, audit, cache, and health endpoints. Scans are limited to 5 per minute and 50 per hour.
- `src/pipeline.js`: a multi-step scan that streams progress through `src/sse.js`. It resolves the company and domain, checks MX records, then runs API lookups, web search, and GitHub search in parallel.
- `src/providers/`: a provider base class and one module per source (Hunter, Snov, Apollo, Pappers, Companies House, GitHub, Wayback, RDAP, SMTP probing, and four search engines with fallback order Jina, Serper, Tavily, Bing).
- `src/predictions.js`, `pattern-inference.js`, `pattern-stats.js`: generate candidate addresses from name variants and infer the company's address pattern.
- `src/scoring.js`: adds points per source and per verification, subtracts for generic addresses and catch-all domains, and eliminates addresses with invalid MX or SMTP. Results fall into verified (90 or more), probable (60 to 89), and possible (30 to 59).
- `src/cache.js`, `dnc.js`, `audit-log.js`: SQLite-backed scan cache, do-not-contact list, and audit log.

## Stack

Node.js, Express, node-fetch, dotenv, cors, optional better-sqlite3, and a single-page front end in plain HTML with Tailwind loaded from a CDN. Tests use the built-in `node --test` runner.

## Status

Version 6.0.0, tracked in `package.json`. The repository holds 7 test files covering scoring, address prediction, pattern inference, MX fingerprinting, the provider base class, and the Hunter provider. The pipeline itself has no automated test. Exports are available for CSV, HubSpot, Salesforce, and Pipedrive.
