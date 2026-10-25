---
name: shipping-a-change
description: What to update when you change something in this repo, and what "done" requires. Use before opening a pull request.
---

# Shipping a change

## Add a new CMS Hotel field

1. `lib/cms/store.js` — add coercion/validation to `normalizeRecord` and a default in `create()`.
2. `lib/cms/csv.js` — add to `COLUMNS`, `rowToInput`, and `toCsv`.
3. `lib/cms/merge.js` — add to `publicView` if the field is public.
4. `CONTEXT.md` — update the CMS Hotel glossary entry.
5. `test/cms.test.js` — add a create/update round-trip test.
6. `npm test` — verify.

## When you change this, also change that

| Change | Also update |
|---|---|
| `lib/config.js` | `.env.example`, `readme.md` |
| `lib/cms/store.js` | `lib/cms/csv.js`, `lib/cms/merge.js`, `CONTEXT.md`, `test/cms.test.js` |
| `lib/auth/admin.js` | `test/cms-admin.test.js`, `.env.example` |
| `api/index.js` routes | `readme.md` API examples, matching `test/*.test.js` |
| `lib/portal/search.js` / `lib/portal/hotel.js` | `test/search.test.js` / `test/hotel.test.js`, `readme.md` |
| `public/admin/*` | `readme.md` Hotel CMS section |
| `data/cms.json` | commit it — Vercel drops uncommitted writes on deploy |

## Done

- `npm test` passes.
- Any behavior change ships with a test that fails without the change.
- New env vars appear in both `lib/config.js` and `.env.example`.
- Any change to a public response shape is reflected in `readme.md`.
