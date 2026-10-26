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
- **No model provider.** `server.ts` also runs the real generation worker with the fake LLM in
  `fake_llm.ts`, and gives the app an empty `ANTHROPIC_API_KEY`. The fake answers with a valid
  lesson for the prompt's lesson ("Generated title for lesson N"), reports the estimate's tokens
  (so costs are real Haiku-class dollars), waits `E2E_FAKE_LLM_DELAY_MS` (default 1000) per call,
  and fails any lesson whose Text Dependent Question contains `E2E-FAIL`. The app runs with
  `E2E_GENERATION_ENV` (`env.ts`): concurrency 4, 2 attempts, $5 run cap, `SPEND_CAP_USD=20`.
- The dashboard and prompt editor specs (`dashboard_*.spec.ts`, `prompt_editor.spec.ts`) import
  the sample outline through the import service and write fixed generation and review states to
  the database the way the worker does, NOTIFY included (`dashboard_support.ts`).
- `IMPORT_TEST_SHEET_URL` (see `.env.example`) enables the live sheet-link test; it is skipped
  when unset. The "not shared by link" test uses a made-up sheet id, so it needs no real sheet.
- Each mockup state saves a full-page screenshot to `test-results/screens/<state>.png`, named
  after the mockup in `docs/design/lesson-authoring/`, for a reviewer to compare by eye. There
  are no pixel-diff assertions. Pages with forms are checked with axe (WCAG 2.1 A/AA).

`npm run test:e2e` first deletes `.next` and `dist`: `next dev` started over the production build
output (`npm run build`, standalone) has gone into a recompile loop that fails every sign-in.
Run Playwright directly (`npx playwright test`) to keep a build you still need.

These tests are not part of `npm run check`: starting Postgres and compiling the app with
`next dev` takes about a minute before the first test runs.
