# Lesson authoring workflow

An internal tool for a curriculum team. A content expert imports a unit outline (a spreadsheet of
about 40 lessons), the system writes a standards-aligned, 50-minute teacher lesson for each row
with an LLM in the background, and a team of 20+ reviewers edits the lessons together in a
WYSIWYG editor (ProseMirror + Yjs) with AI assistance, moving each one through review to
Approved. Approved lessons export as JSON or standalone HTML. It is a Next.js app with a separate
generation worker and collaboration server, all backed by one Postgres database.

- [Architecture](docs/architecture.md): services, data model, generation pipeline,
  collaboration, tradeoffs and what we'd do next.
- [Requirements](docs/requirements/lesson-authoring.md) (R1-R35), referenced below as Rn.
- [Deploying to Railway](docs/deploy.md), [performance results](docs/performance.md),
  [design](docs/design/lesson-authoring.md) and [how AI was used to build it](docs/ai_usage.md).

## Feature tour

**Outline import (R1-R5).** Paste a Google Sheets link shared as "anyone with the link" (read
through its CSV export, no Google credentials) or upload the CSV. The parser reads the banner
(grade, unit, anchor text, ISBN), arcs, numbered lessons, flex days and all 16 columns, and
normalizes standards codes ("RL.6.1, 6.2 L.6.4" becomes RL.6.1, RL.6.2, L.6.4). A preview lists
every lesson with warnings (for example a code missing from the standards data) before anything
is saved; cancelling leaves nothing behind. An optional ELD scope-and-sequence file adds its
non-empty fields to each matching lesson's generation input.

**Generation (R6-R12).** "Generate lessons..." queues one background job per numbered lesson and
returns at once; closing the browser doesn't stop it. A separate worker process runs the jobs with
a concurrency limit, survives restarts without redoing finished lessons, and retries invalid model
output once with the validation errors. The unit page shows each lesson's status and the run's
cost live. Authors edit the unit's prompt (system instructions, style guide, per-lesson-type
guidance); each save is a new prompt version, and each lesson records the version, model, tokens
and cost it was generated with. Authors can regenerate one, several or all failed lessons, cancel
a run, and generate a flex day on request. A per-run cap and a global cap stop spending ("stopped:
spend cap reached").

**Editor and collaboration (R14, R15, R17-R19).** The lesson editor is Tiptap (ProseMirror) with a
document schema derived from the lesson's Zod schema, so every edit still produces a valid lesson.
Several people edit the same lesson at once through Yjs and a Hocuspocus server, with live cursors
and names. Standards in the front matter come from the reference data (grade 6 CA CCSS ELA, CA ELD
and CA school library standards), and hovering or focusing a code shows its full text. Every save
keeps a version that can be previewed, compared and restored. A read-only lesson view lays the
lesson out for teachers.

**AI assist (R20-R22).** Select text and choose Rewrite, Shorten, Simplify for the grade, or a
free-form instruction; the suggestion shows inline and changes nothing until accepted, as one
undoable step. A reviewer can also regenerate one section with an instruction, or run a standards
alignment check that lists each focus standard as addressed, partly addressed or missing, with
links to the evidence. AI assist spend counts against the same global cap as generation.

**Review workflow (R23-R25).** Lessons move Draft → In review → Changes requested → Approved (plus
Generating and Failed). Only approvers approve or request changes, and a change request needs a
note. Approved lessons are locked in every open editor until an approver reopens them. Every
transition is recorded with who, when and the note. The unit dashboard filters by status, arc and
assignee, counts lessons per status and marks the unit complete when all are approved. Authors
and approvers assign lessons, singly or in bulk; reviewers see "My lessons".

**Export (R16).** Download a lesson, or every approved lesson of a unit, as JSON matching the
lesson schema or as standalone HTML.

**Auth (R27).** Email and password sign-in against seeded accounts, roles checked on the server
for every page, API route and the collaboration server.

Not built: watching a lesson stream in as it is written (R13, bonus) and comments (R26, bonus).

## Quick start from a clean clone

Needs Node 24, npm and Docker (running).

```sh
cp .env.example .env
# Set AUTH_SECRET in .env, for example to the output of: openssl rand -base64 32
docker compose up -d --wait   # Postgres 16 on localhost:5432 (set POSTGRES_PORT in .env to change)
npm install
npm run db:migrate
npm run db:seed               # demo accounts and standards
npm run dev                   # web, worker and collab together
```

Open http://localhost:3000 and sign in with a demo account below. `npm run dev` runs three
processes:

| Process | Entry point          | Local port | What it does                                        |
| ------- | -------------------- | ---------- | --------------------------------------------------- |
| web     | `src/app` (Next.js)  | 3000       | UI, API routes, Auth.js sign-in, AI assist          |
| worker  | `src/worker/main.ts` | 4100       | pg-boss job worker: lesson generation               |
| collab  | `src/collab/main.ts` | 4200       | Hocuspocus (Yjs) server, documents kept in Postgres |

Each answers `GET /health` with 200 when it can reach the database (503 otherwise). With
`DATABASE_URL` empty, every process uses the compose database
(`postgres://postgres:postgres@localhost:${POSTGRES_PORT:-5432}/lesson_authoring`). Leave `PORT`
unset locally so the three processes keep their own ports. Secrets come only from `.env`, which
is git-ignored; `.env.example` lists every variable.

To use other ports, run `PORT=<n> npm run dev:web`, `PORT=<n> npm run dev:worker` and
`PORT=<n> npm run dev:collab` in separate terminals and set `COLLAB_URL=ws://localhost:<collab
port>` for the web process; the stand-in model below takes `FAKE_MODEL_PORT` (match it in
`ANTHROPIC_BASE_URL`).

### Demo accounts (local only)

`npm run db:seed` creates these accounts. Their password is `SEED_PASSWORD`, or `demo-password`
when that is unset. The default is for local development only: in production `SEED_PASSWORD` is
required, the seed refuses to run without it, and `demo-password` does not work on a hosted
deployment.

| Role     | Emails                                                   |
| -------- | -------------------------------------------------------- |
| admin    | `admin@example.com`                                      |
| author   | `author01@example.com`, `author02@example.com`           |
| approver | `approver01@example.com`, `approver02@example.com`       |
| reviewer | `reviewer01@example.com` … `reviewer20@example.com` (20) |

Re-running the seed is safe: it upserts the accounts (resetting their password to the current
`SEED_PASSWORD`) and the standards.

## Import the sample and generate

1. Sign in as `author01@example.com`, open **Units** and choose **Import an outline**.
2. Choose **Upload CSV**, pick `data/sample_unit/lesson_outline.csv` and, optionally, the ELD file
   `data/sample_unit/eld_scope_and_sequence.csv`, then **Read outline**. The sample ELD file's
   content columns are empty, so it adds nothing to generation: a notice that its content columns
   are empty and that 7 ELD rows didn't match a lesson is expected.
3. Check the preview (41 lessons in 4 arcs, 6 flex days; lessons 22, 26 and 31 carry a standards
   warning) and choose **Create unit with 41 lessons**.
4. On the unit page, **Generate lessons...** shows the lessons, model, prompt version, estimated
   cost and the run's spend cap. **Start generation** queues the run; statuses and cost update
   live, and each lesson opens as soon as it is done.

### Without cost: the stand-in model

`npm run load:fake-model` starts a stand-in for the Anthropic API that answers every generation
request with a valid lesson after a delay. The worker keeps its real Anthropic adapter and reaches
the stand-in through `ANTHROPIC_BASE_URL`, so no request can reach Anthropic. In `.env`:

```sh
ANTHROPIC_API_KEY=fake-local-key
ANTHROPIC_BASE_URL=http://localhost:3764
```

Then, in a second terminal, before `npm run dev`:

```sh
FAKE_MODEL_DELAY_MS=3000-8000 npm run load:fake-model   # default delay is 60-90 s per lesson
```

With a 3-8 s delay a full 41-lesson run finishes in about a minute. The lessons are placeholder
text ("Generated title for lesson N"), but every status, version and dashboard feature works.
The stand-in reports realistic token counts, so each run records Haiku-class dollars (about $0.51
for the unit) against the local `SPEND_CAP_USD` budget (default $20); raise it in `.env` for many
practice runs. The stand-in only writes lessons, so AI assist needs a real key.

### With a real key

Set `ANTHROPIC_API_KEY` in `.env`, leave `ANTHROPIC_BASE_URL` empty, and restart `npm run dev`.
Generation uses the Haiku-class model by default (`GENERATION_MODEL`; the start dialog also offers
Sonnet- and Opus-class models), and AI assist uses `ASSIST_MODEL` (Haiku-class by default). The
start dialog shows the estimate before anything is spent. Two caps apply, both from `.env`:

- `GENERATION_SPEND_CAP_USD` (default $5): the cap for one run.
- `SPEND_CAP_USD` (default $20): the total across every run and AI assist call in this database.

Each model call reserves one lesson estimate against both caps before it starts, so spend can end
above a cap by at most the last admitted call's estimate plus what a call in flight costs beyond
its estimate (and, for the global cap, AI assist calls made meanwhile). Details:
[Caps and reservations](docs/architecture.md#generation-pipeline).

`GENERATION_CONCURRENCY` (default 4) and `GENERATION_MAX_ATTEMPTS` (default 2, one repair retry)
bound how many calls run at once and per lesson.

Try a few lessons first: select them in the table and choose **Selected lessons** in the start
dialog.

## Quality gates

| Command                                      | What it checks                                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `npm run check`                              | Format check, lint, type check, unit, component and integration tests, and the scrub check (R32) |
| `npm run test:e2e`                           | Playwright end-to-end tests against the real app with a fake model (see `tests/e2e/README.md`)   |
| `npm run docker:smoke`                       | Builds the production image and runs the full flow in browsers against it (see `docs/deploy.md`) |
| `npm run load:reviewers` / `load:generation` | R28 (25 reviewers + 2 co-editing pairs) and R29 (41-lesson run) against a production build       |

- `npm run check` needs Docker: integration tests start a throwaway Postgres 16 with
  Testcontainers (or use `TEST_DATABASE_URL`, an existing empty database).
- The scrub check fails when a git-tracked file contains a banned term. It reads the terms, one
  per line, from the file named by `SCRUB_TERMS_FILE` (or the project's private terms file); the
  terms file is never committed, and without one the check fails rather than passing.
- `npm run test:e2e` needs the Playwright Chromium once: `npx playwright install chromium`. It is
  not part of `check` because the app takes about a minute to start.
- The load scripts need a production build and their own services and environment; the steps and
  the results are in [docs/performance.md](docs/performance.md). No test or load script calls a
  real model.

## Scripts

| Script                                                      | What it does                                                    |
| ----------------------------------------------------------- | --------------------------------------------------------------- |
| `npm run dev`                                               | Runs web, worker and collab with reload                         |
| `npm run dev:web` / `dev:worker` / `dev:collab`             | Runs one process                                                |
| `npm run build`                                             | Production build: `next build` (standalone) and `dist/` bundles |
| `npm run start:web` / `start:worker` / `start:collab`       | Runs one production process after `npm run build`               |
| `npm run db:generate`                                       | Writes a new migration in `drizzle/` from `src/db/schema.ts`    |
| `npm run db:migrate`                                        | Applies migrations (and backfills content ids)                  |
| `npm run db:seed`                                           | Seeds demo accounts and standards                               |
| `npm run format`                                            | Formats every file with Prettier                                |
| `npm run test:unit` / `test:component` / `test:integration` | One Vitest project                                              |
| `npm run scrub`                                             | The scrub check alone                                           |
| `npm run load:fake-model`                                   | Stand-in Anthropic API (never calls a model)                    |

## Standards reference data

The seed loads every `data/standards/*.json` file: an array of `{ "code", "framework", "grade",
"strand", "text" }` with framework `CCSS_ELA`, `CA_ELD` or `CA_SCHOOL_LIBRARY`, upserted by code.
`data/standards/README.md` says where the text comes from and how it was extracted.

## Hosting

One `Dockerfile` builds the image for all three processes; `.railway/railway.ts` describes the
Railway services. Setup, variables per service, the one-time seed and the post-deploy checklist
are in [docs/deploy.md](docs/deploy.md).
