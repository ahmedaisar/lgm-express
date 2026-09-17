# CONTEXT.md

## Glossary

**Portal Hotel** — rates-only hotel data owned by the Lets Go Maldives portal:
name, room/meal prices, availability, transfers. Keyed by `hotel_slug`
(URL key) with a numeric `hotel_id`. We read it, never edit it.

**CMS Hotel** — content owned by us: `id` (our stable key, auto-slugified from
name, immutable), `name`, `description`, `atoll`, `stars`, `photos[]` (URL
list), `amenities[]` (free-text tags), `website`, house rules (`check_in_from`,
`check_in_notes`, `check_out_until`), policies (`cancellation_prepayment`,
`child_policies`, `cot_extra_bed_policies`, `age_restriction`,
`pets_allowed` + `pets_notes`, `payment_methods[]`, `fine_print`), plus link
fields (below) and `updated_at`. Lives in `data/cms.json`.

**Mapping** — an explicit admin-made link between one CMS Hotel and one Portal
Hotel: `portal_hotel_id` (the link; numeric portal id as string) plus
`portal_slug` (convenience copy used to fetch detail pages). `null` means a
content-library entry not yet linked. Links are made by hand, never guessed;
id-based so portal slug renames don't break them.

**CMS merge** — on read, public responses gain `cms: {id, name, description,
atoll, stars, photos, amenities, website}` when a mapping exists, `cms: null`
when unmapped. Applies to `/search` rows and `/hotels/:id`.

**JSON file store** — `data/cms.json` is the source of truth, committed to the
repo. Admin writes apply atomically. Local/VPS = persistent; Vercel = persists
until next deploy, then last-committed state returns — commit after big imports.

## Open questions

(none — CMS v1 scope locked in grilling round 2)
