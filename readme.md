# LGM Rate Proxy — Express port

Node.js/Express port of the Lets Go Maldives Rate Proxy API (`../lgm`),
shaped for Vercel serverless deployment. Same two endpoints over the same
portal AJAX contract (see `../lgm/docs/ADR-001-integration-approach.md`):
`GET /search`, `GET /hotels/:hotelId`, plus `GET /health`, `GET /health/portal`.

No API keys: all endpoints are open. Abuse protection is the portal-side
concurrency cap only (max simultaneous live portal requests) — do not expose
this publicly without adding auth in front (Vercel firewall, basic auth, etc.).

## Quickstart (local)

Requires Node 18+.

```bash
npm install
cp .env.example .env   # fill in PORTAL_USERNAME / PORTAL_PASSWORD
npm start               # http://localhost:8000
```

```bash
curl localhost:8000/health
curl "localhost:8000/search?date_start=2026-10-01&date_end=2026-10-05&adults=2&nationality=USA&per_page=3"
curl "localhost:8000/hotels/sun-resort?date_start=2026-10-01&date_end=2026-10-05&nationality=USA"
```

`npm test` runs the unit suite (`node:test`, no extra deps).

## Hotel CMS (internal)

Minimal content backend for what the portal doesn't provide (photos,
descriptions, amenities). One CMS Hotel links to one Portal Hotel via
`portal_hotel_id` (numeric portal id; `portal_slug` kept as a convenience
copy) — links are made by hand, never guessed. Public `/search` rows and
`/hotels/:id` gain `cms: {...}`, or `cms: null` when unmapped.

Storage is `data/cms.json`, committed to the repo. Writes are atomic;
local/VPS keeps them, Vercel keeps them only until the next deploy (then the
last-committed file returns) — commit after big imports.

Admin (single role): set `ADMIN_USER`/`ADMIN_PASSWORD`/`ADMIN_JWT_SECRET`,
then open **`GET /admin/`** — a Tailwind admin UI (login, hotel table with
filter, add/edit form, CSV import/export, delete). It calls the same JSON
endpoints below with a Bearer token; without admin env the UI's login answers
503 and the public API is unaffected.

```bash
curl -X POST localhost:8000/admin/login -H 'Content-Type: application/json' \
  -d '{"user":"boss","password":"s3cret"}'            # -> {"token":"..."}
T=...  # the token
curl -X POST localhost:8000/admin/hotels -H "Authorization: Bearer $T" \
  -H 'Content-Type: application/json' -d '{
    "name": "Sun Resort", "atoll": "Male Atoll", "stars": 5,
    "photos": ["https://.../a.jpg"], "amenities": ["wifi", "spa"],
    "portal_hotel_id": "11", "portal_slug": "sun-resort"}'
curl "localhost:8000/admin/hotels" -H "Authorization: Bearer $T"
curl -X PUT localhost:8000/admin/hotels/sun-resort -H "Authorization: Bearer $T" \
  -H 'Content-Type: application/json' -d '{"description": "Beach fun"}'
# bulk: columns id,name,description,atoll,stars,photos,amenities,website,portal_hotel_id,portal_slug
curl -X POST localhost:8000/admin/import -H "Authorization: Bearer $T" \
  -F "file=@hotels.csv"                               # -> {created, updated, errors[]}
curl "localhost:8000/admin/export" -H "Authorization: Bearer $T" -o cms-export.csv
```

`photos`/`amenities` accept `|`-separated strings or arrays. Import upserts by
`id`, then `portal_hotel_id`, else creates (blank cells never wipe on update).

## Deploy to Vercel

```bash
vercel env add PORTAL_USERNAME
vercel env add PORTAL_PASSWORD
# optional: PORTAL_RATE_CODE, MAX_CONCURRENT_PORTAL_REQUESTS, LOG_LEVEL
vercel --prod
```

`api/index.js` is the serverless entrypoint (exports the app; listens only on
direct run). `vercel.json` pins `maxDuration: 60` — needs a Pro plan for the
full 60s; Hobby caps lower, which can cut off slow multi-part searches.

Behind a TLS-inspecting local network, Node honors the standard escape hatch
`NODE_TLS_REJECT_UNAUTHORIZED=0` for local testing only — never on Vercel/prod.

## Differences from the Python service

- **No auth, no rate limiter.** The Python service has per-member API keys
  (SQLite) + per-key rate limits; this port drops both for simplicity. The only
  guardrail left is `MAX_CONCURRENT_PORTAL_REQUESTS` against the portal.
- **Portal session is per-instance.** Concurrent serverless instances each hold
  their own login against the one shared agency account. Fine at low traffic;
  at scale this risks parallel logins and session churn — the Python service
  on a single VPS remains the safer host for heavy use.

Otherwise behavior is identical: shared-session login with verified probe,
dash-joined search ages / comma-joined skeleton ages, slug-only hotel routes,
`no_results` envelopes, 404/422/502 semantics. Room net prices carry `MARKUP`
(default 10%); transfers are never marked up.
