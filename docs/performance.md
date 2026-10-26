# Performance (R28, R29)

Both checks run against a **production build** (`npm run build`; the web app's standalone
`server.js`, `dist/collab/main.mjs`, `dist/worker/main.mjs`) on a local Postgres 16. Neither
calls a real model: the worker keeps its real Anthropic adapter and talks to a stand-in API
(`scripts/load/fake_model.ts`) through `ANTHROPIC_BASE_URL`.

## Results (2026-10-26)

Machine: Apple M2, 8 cores, 16 GB RAM, macOS, Node 24.22. Everything (Postgres in Docker, web,
collab, worker, fake model and the load script) ran on this one laptop.

### R28: 25 reviewers plus 2 co-editing pairs, 5 minutes: met

29 clients (25 on their own lessons, 2 pairs sharing 2 more), 304 s.

| Measure (ms)                                    | Samples |   p50 |   p95 |   max |
| ----------------------------------------------- | ------: | ----: | ----: | ----: |
| **Dashboard open** (HTML + API)                 |     154 |    87 |   412 |   571 |
| - unit page HTML                                |     154 |    65 |   275 |   477 |
| - `GET /api/units/:id/dashboard`                |     154 |    22 |   104 |   167 |
| **Lesson open** (HTML + token + first Yjs sync) |     154 |    62 |   239 |   340 |
| - editor page HTML                              |     154 |    34 |   133 |   216 |
| - `GET /api/collab-token`                       |     154 |     6 |    45 |   140 |
| - first Yjs sync                                |     154 |    14 |    76 |   159 |
| Status poll (every 2 s per editor)              |   4,089 |    12 |    95 |   382 |
| Co-editor sees partner's text                   |     162 |     1 |     8 |    19 |
| Sign-in (all 29 at once)                        |      29 | 2,310 | 2,316 | 2,327 |

- **Errors: 0** (HTTP, collab auth, sync timeouts, socket drops, unsaved edits, flushes).
  Reconnects: 0.
- **Lost edits: 0.** 13,286 keystrokes made 1,256 markers; every one is in the stored Yjs state
  (`yjs_documents`) and in the lesson snapshot (`lessons.content`) at the end.
- Both p95 open times are under the 1 s target.
- The 60 s short mode (`LOAD_SHORT=1`) gave the same picture: 0 errors, 0 lost of 238 markers,
  dashboard p95 271 ms, lesson open p95 289 ms.

### R29: full 41-lesson unit at the default concurrency: met (projected)

| Measure                      | Value                                                  |
| ---------------------------- | ------------------------------------------------------ |
| Lessons                      | 41 numbered lessons (flex days aren't in a run)        |
| Concurrency                  | 4 (default `GENERATION_CONCURRENCY`); 4 seen live      |
| Fake model time per lesson   | uniform 60-90 s; measured p50 77 s, mean 75 s          |
| **Wall time, start to done** | **800 s (13.3 min)**, all 41 on the first attempt      |
| Ideal at that latency        | 41 x 75 s / 4 = 769 s; overhead + last-wave tail ~31 s |

**Where 60-90 s comes from.** Two sets of real calls were timed in this project. The 60-90 s
range is modelled on a 3-lesson Sonnet-class probe measured during development (lessons 1, 4 and
5: 60-97 s per call, about 9.4k input and 10.6k-14.3k output tokens each, about $0.40-0.50 for
the three calls at the Sonnet prices in `src/generation/llm.ts`); that probe is not recorded
elsewhere in the repo. The only recorded Haiku-class call (the run's default model) is one Core
Writing call that took 126 s (`src/generation/README.md`), above the fake's range. The
projections below cover that case.

**Projection for a real run.** Wall time is about `calls / concurrency x mean call time` plus a
tail of up to one call, plus the ~30 s measured overhead:

| Assumption                                          | Calls |       Projected wall |
| --------------------------------------------------- | ----: | -------------------: |
| Measured fake (75 s mean)                           |    41 |    13 min (measured) |
| 97 s mean (top of the Sonnet probe)                 |    41 |              ~18 min |
| 97 s mean, 10% of lessons need the repair retry     |    45 |              ~20 min |
| 126 s every call (the slow Haiku Core Writing case) |    41 |              ~24 min |
| Break-even for 30 min with 45 calls                 |    45 | ~150 s mean per call |

So a full unit finishes in under 30 minutes unless calls average over about 2.5 minutes, or the
API's rate limits slow them. Token throughput uses the committed per-lesson estimate
(`ESTIMATED_TOKENS_PER_LESSON` in `src/generation/llm.ts`: 9k input and 23k output, from the M2
Haiku smoke run), which is larger than the Sonnet probe's output and so the safer figure for rate
limits. With 4 calls in flight, a 75 s mean call needs about 29k input and 74k output tokens per
minute; at 126 s per call it is about 17k input and 44k output. An account whose per-minute limits
are below that will queue calls (the SDK retries 429s) and stretch the run. Raising
`GENERATION_CONCURRENCY` shortens it in proportion, within those limits and the run's spend cap.

## Method

### R28 (`npm run load:reviewers`, `scripts/load/reviewers.ts`)

Setup, through the real services: upserts 29 reviewer accounts (`load-reviewer01..29`), imports
a fresh copy of the sample unit with the import service, gives 27 lessons generated content as
Drafts (with a generated version) and assigns each to its reviewer. Every run uses a new unit, so
no Yjs document exists before the run.

Each simulated reviewer, in one Node process:

1. Signs in through Auth.js (csrf, credentials callback, session cookie).
2. **Dashboard open:** `GET /units/:id` (full server render) then `GET /api/units/:id/dashboard`.
3. **Lesson open:** `GET /lessons/:id` (the editor page), `GET /api/collab-token`, then a real
   `HocuspocusProvider` on `lesson:<id>` until its first sync; sets its awareness `user`.
4. Edits like a person: types a marker such as ` [r07-012]` one character per Yjs transaction at
   120-300 ms per key, 3% of keys a typo fixed with backspace, then pauses 2-8 s; updates its
   awareness cursor on every key. The cursor is a Yjs relative position, so co-editors typing in
   the same paragraph each keep their words together, as in the browser.
5. Polls `GET /api/lessons/:id/status` every 2 s with `If-None-Match`, as the editor does.
6. After 48-72 s (`LOAD_SESSION_S`, default 60 +-20%) waits until the server acknowledged its
   edits, closes the provider and goes back to step 2, so each reviewer contributes about five
   open timings. At the end it waits for acknowledgement and sends the editor's `flush` message.

The 2 pairs open the same lesson and type into the same paragraph at the same time. Each side
records when it finished a marker; the other side records when that marker appears in its copy
("co-editor sees partner's text").

**No lost edits** (`scripts/load/lost_edits.ts`, unit tested in `lost_edits.test.ts`): after the
run and the store debounce, the script reads each lesson's `yjs_documents.state` and
`lessons.content` and reports every marker missing from either. Any error, lost edit, or a p95
open time of 1 s or more exits 1.

Options: `LOAD_REVIEWERS` (25), `LOAD_PAIRS` (2), `LOAD_DURATION_S` (300; `LOAD_SHORT=1` makes it
60), `LOAD_SESSION_S` (60), `LOAD_BASE_URL`, `LOAD_COLLAB_URL`, `LOAD_PASSWORD`,
`LOAD_RESULTS_FILE` (JSON; default under `test-results/load/`).

### R29 (`npm run load:generation`, `scripts/load/generation.ts`)

Imports a fresh sample unit, signs in as `author01` and starts a full run with
`POST /api/units/:id/generation/runs` (default model, concurrency and caps), then reads the run
and its jobs every second until it finishes. Wall time is from the POST to the run's final
status (the run's own `created_at` to `finished_at` agrees). Per-lesson time is from a job first
seen `generating` to `generated` (±1 s).

The worker runs the real queue, prompt building, validation, post-processing and database writes;
only the HTTP answer is fake: `fake_model.ts` waits `FAKE_MODEL_DELAY_MS` (default `60000-90000`)
and streams a valid lesson for the prompt's lesson with the cost estimate's token counts, so the
run's spend is recorded in (fake) Haiku-class dollars. Spend counts against `SPEND_CAP_USD`, so
the load environment raises it (below).

### Running it

```sh
npm run build
docker run -d --name load-pg -p 3760:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=load \
  postgres:16-alpine -c max_connections=200
export NODE_ENV=production DATABASE_URL=postgres://postgres:postgres@localhost:3760/load
export AUTH_SECRET=$(openssl rand -base64 32) SEED_PASSWORD=demo-password
export COLLAB_URL=ws://localhost:3762 SPEND_CAP_USD=1000          # fake dollars
export ANTHROPIC_API_KEY=fake-load-key ANTHROPIC_BASE_URL=http://localhost:3764
npm run db:migrate && npm run db:seed
FAKE_MODEL_PORT=3764 npm run load:fake-model &
PORT=3761 HOSTNAME=localhost node .next/standalone/server.js &
PORT=3762 node dist/collab/main.mjs &
PORT=3763 node dist/worker/main.mjs &

npm run load:reviewers                 # R28, 5 minutes (LOAD_SHORT=1 for 1 minute)
npm run load:generation                # R29, ~13 minutes at 60-90 s per lesson
```

Run them one at a time so neither skews the other. `FAKE_MODEL_DELAY_MS=2000-3000` gives a quick
end-to-end check of the R29 script.

## Limits

- **One machine.** The load script, Postgres and all three services share one laptop, so the
  numbers include their contention, and there is no network latency. Railway adds round trips
  and has smaller containers; this does not measure the hosted demo.
- **HTML and API only.** Page opens fetch the server-rendered HTML and the API calls a page makes,
  not JavaScript or CSS bundles (a browser caches them after the first visit) and not the
  client-side render. The editor's ProseMirror render isn't measured; the R18 end-to-end test
  covers typing in real browsers.
- **The dashboard's live feed isn't held open.** Reviewers spend their time in the editor; the
  dashboard's SSE stream (`/generation/events`) is short-lived there and was not simulated.
- **Sign-in burst.** All 29 sign in in the same second; bcrypt (cost 10) runs one at a time in
  the web process, so the last waits about 2.3 s. Real reviewers don't sign in in the same second;
  sign-in isn't part of R28's open-time target.
- **Typing pattern.** Markers are typed at the end of one paragraph per lesson; the app's
  structural edits (adding blocks, parts, standards) and AI assist are not in the mix.
- **R29 is projected, not run against the API.** The fake fixes the latency and never returns
  invalid output, so the retry share and rate limits are assumptions (table above), not
  measurements.
