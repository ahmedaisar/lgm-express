# Changelog

All notable changes to this project are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project does not tag releases yet; entries are grouped under `Unreleased` until it starts cutting versions.

## [Unreleased]

### Added

- Hotel CMS: JSON file store, CSV import/export, and `cms: {...}` merge into `/` and `/hotels/:id`.
- Admin API and SPA under `/admin/*` with single-admin Bearer JWT auth.
- Commission settings.

### Changed

- Public response shapes documented in `readme.md` for the CMS merge.

## [0.2.0] - 2025-09-16

### Added

- Express port of the LGM Rate Proxy API, shaped for Vercel serverless (`api/index.js`, `vercel.json`).
- `GET /`, `GET /hotels/:hotelId`, `GET /health`, `GET /health/portal`.
- Shared-session portal login with a concurrency guard (`MAX_CONCURRENT_PORTAL_REQUESTS`).
- Sell-price markup over portal net prices (`MARKUP`), transfers untouched.
