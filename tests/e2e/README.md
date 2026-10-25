# End-to-end tests

Playwright, Chromium only, against the real app and a seeded database. Run with:

```sh
npx playwright install chromium   # once, if the browser is not cached yet
npm run test:e2e                  # all specs
npm run test:e2e -- tests/e2e/import.spec.ts -g "preview"
```

- `server.ts` is Playwright's `webServer`: it starts a throwaway Postgres 16 with Testcontainers
  (Docker must be running), migrates it, seeds the demo accounts and standards, then runs
  `next dev` on port 3410 (override with `E2E_PORT`, e.g. `E2E_PORT=3420 npm run test:e2e`) with a
  test-only `AUTH_SECRET`. Set `E2E_DATABASE_URL`
  to use an existing empty database instead.
- Each test starts with no units or pending imports (`support.ts` truncates them). Specs run one
  at a time because they share the database.
- `IMPORT_TEST_SHEET_URL` (see `.env.example`) enables the live sheet-link test; it is skipped
  when unset. The "not shared by link" test uses a made-up sheet id, so it needs no real sheet.
- Each mockup state saves a full-page screenshot to `test-results/screens/<state>.png`, named
  after the mockup in `docs/design/lesson-authoring/`, for a reviewer to compare by eye. There
  are no pixel-diff assertions. Pages with forms are checked with axe (WCAG 2.1 A/AA).

These tests are not part of `npm run check`: starting Postgres and compiling the app with
`next dev` takes about a minute before the first test runs.
