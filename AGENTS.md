# AGENTS.md

## Commands

- `npm start` / `npm run dev` — run the Express app on `PORT` (default 8000).
- `npm test` — run the Node built-in test suite (`node --test "test/*.test.js"`).
- `npm run load -- --requests 200 --concurrency 20` — portal-free load smoke.

## Conventions

- CommonJS only (`"type": "commonjs"`); no ESM `import`/`export`.
- Env is read through `lib/config.js`. Add a new setting there (with a default) and in `.env.example` — do not read `process.env` inside route handlers or lib modules, except the lazily-read knobs already documented in `lib/log.js` and `lib/auth/admin.js`.
- Errors thrown as `HttpError(status, message)` (`lib/api/common.js`) are serialized by `sendError` in `api/index.js`. Throw `HttpError` for client errors; anything else becomes a 502 with a generic portal message.
- Portal internals (numeric country IDs, portal hotel IDs) never leave `lib/portal/*` and `lib/cms/merge.js`; public responses expose slugs and ISO3 only.
- CMS records are normalized in `lib/cms/store.js` (`normalizeRecord`). Add a new hotel field in three places: `normalizeRecord`, the `create()` defaults, and `csv.js` (`COLUMNS`, `rowToInput`, `toCsv`).
- `data/cms.json` is the committed source of truth. On Vercel, writes are lost on the next deploy — commit after big imports.
- Serve-then-redirect rule for the admin SPA: plain `/admin` redirects to `/admin/`; non-strict Express routing makes `/admin` also match `/admin/`, so only redirect the slash-less form (see `api/index.js`).
- Tests use `node:test` + `node:assert/strict`, and put temp CMS stores in `fs.mkdtempSync(os.tmpdir())`. Follow that pattern rather than writing into `data/`.

## Adding a new public API route

1. `api/index.js` — add the handler next to the related route, wrapped in `try/catch { sendError(res, err) }`.
2. `lib/api/common.js` — add a parser if the route takes a new query/body shape.
3. `lib/config.js` + `.env.example` — add any new knob.
4. `test/` — add a `*.test.js` that boots `require("../api/index.js")` on port 0 and asserts the status/body.

## Adding a new CMS Hotel field

1. `lib/cms/store.js` — `normalizeRecord` coercion/validation, and the default in `create()`.
2. `lib/cms/csv.js` — `COLUMNS`, `rowToInput`, `toCsv`.
3. `lib/cms/merge.js` — `publicView` if the field is public.
4. `CONTEXT.md` — the CMS Hotel glossary entry.
5. `test/cms.test.js` — a create/update round-trip test.

## Common pitfalls

- The portal is a scraping client against one shared agency login. `MAX_CONCURRENT_PORTAL_REQUESTS` is the only abuse guard; do not add new live portal calls without going through `PortalSession`.
- `/hotels/:hotelId` only accepts slugs. Numeric IDs 404 on purpose — `/` returns `hotel_slug`, use that.
- `date_start`/`date_end` are `YYYY-MM-DD` and `date_end >= date_start`; invalid input is 422, not 400.
- Admin routes answer 503 when `ADMIN_USER`/`ADMIN_PASSWORD` are unset. That is intentional so the public API still boots.
- Read `.env.example`, never `.env`, when documenting configuration.

## Maintenance matrix

| Change | Also update |
|---|---|
| `lib/portal/search.js` or `lib/portal/hotel.js` | `test/search.test.js` / `test/hotel.test.js`, `readme.md` if the response shape changes |
| `lib/portal/session.js` | `test/reliability.test.js`, `readme.md` (session/scale note) |
| `lib/config.js` | `.env.example`, `readme.md` Quickstart/Deploy sections |
| `lib/cms/store.js` | `lib/cms/csv.js`, `lib/cms/merge.js`, `CONTEXT.md`, `test/cms.test.js` |
| `lib/auth/admin.js` | `test/cms-admin.test.js`, `.env.example` |
| `api/index.js` routes | `readme.md` API examples, `test/*.test.js` |
| `public/admin/*` | `readme.md` Hotel CMS section |
| `data/cms.json` | commit it; note Vercel loses uncommitted writes |

## Docs

- `readme.md` — setup, API examples, deploy notes.
- `CONTEXT.md` — domain glossary (Portal Hotel, CMS Hotel, Mapping, CMS merge). Keep it current when the data model changes.
- No `docs/` site or `CHANGELOG.md` yet; add a changelog when the project starts cutting releases.

## Done means

- `npm test` passes.
- Any behavior change ships with a test that fails without the change.
- New env vars appear in both `lib/config.js` and `.env.example`.
- Any change to a public response shape is reflected in `readme.md`.

## Never merges without a human

A person has to have **read this diff** before it lands. Telling an agent "merge it when you're done" is approving a goal, not this change — so it does not count for anything on this list. Everywhere else it counts fine, which is the point of having a list.

- `data/cms.json` — hand-made Portal↔CMS mappings; a wrong link silently serves the wrong content.
- `lib/auth/admin.js` — decides who may read or write the CMS.
- `lib/pricing.js` and the `MARKUP` handling in `api/index.js` — these prices reach customers.
- `.env.example` and `lib/config.js` when a value is a real credential rather than a placeholder.
- Any change to the shape of `/`, `/hotels/:id`, or `/health` responses.
