---
name: security-review
description: Review a change touching the CMS admin, pricing, or config for this repo's specific security surface. Use when a diff touches auth, admin routes, pricing, or configuration.
---

# Security review

## Trust boundary

- `lib/auth/admin.js` is the only thing deciding who may read or write the CMS. `requireAdmin` must run on every `/admin/*` route except `/admin/login` and the static admin UI. Adding a route under `/admin` without `admin.requireAdmin` exposes it publicly.
- `ADMIN_JWT_SECRET` unset means ephemeral tokens that invalidate on every restart (`lib/auth/admin.js`). Do not remove that fallback without replacing it with a hard startup failure.
- `.env.example` holds placeholders on purpose; it is tracked. `.env` is gitignored. Never move a real value into `.env.example`.

## Customer-facing money

- `lib/pricing.js` applies `MARKUP` to room `net_price` only. Transfers must stay unmarked. A change that marks transfers up or marks `net_price` twice is a pricing bug, not a refactor.
- Markup is applied in `api/index.js` at the response boundary, so the portal layer stays pure-net. Keep it there.

## Portal credential exposure

- `PORTAL_USERNAME`/`PORTAL_PASSWORD` are one shared agency login. They flow into `lib/portal/session.js` and must never appear in responses or logs. `sendError` in `api/index.js` already maps login failures to a generic 502 — check any new error path for the same.
- The portal is scraped; `MAX_CONCURRENT_PORTAL_REQUESTS` in `lib/portal/session.js` is the abuse guard. New outbound calls must go through `PortalSession`, not `fetch` directly.

## File store

- `lib/cms/store.js` writes `data/cms.json` via tmp-file + rename. Keep writes atomic; a partial write corrupts the committed source of truth. `multer` uploads are memory-only with a 5 MB limit in `api/index.js` — keep those limits on any new upload route.
