## Description

<!-- What changed and why. Link the issue if there is one. -->

## Changes

<!-- One line per change, with file paths. -->

## How to test

```bash
npm test
```

<!-- Add manual steps for anything the suite does not cover (live portal calls, admin UI). -->

## Checklist

- [ ] `npm test` passes
- [ ] Behavior changes ship with a test that fails without the change
- [ ] New env vars added to `lib/config.js` and `.env.example`
- [ ] `readme.md` updated if a public response shape changed
- [ ] New CMS fields also added in `lib/cms/csv.js` and `lib/cms/merge.js`
- [ ] `data/cms.json` committed if it changed
