# Deploying to Railway (R31)

The hosted demo runs as three Railway services built from this repo, plus a Railway Postgres. The
owner creates the Railway project, the database and the secrets. This page lists every setting.

## Service list and env per service

All three services build the same `Dockerfile` (one image: Next.js's standalone server plus
esbuild bundles of the other processes, non-root `node` user, about 230 MB); each picks its
process with its start command. `.railway/railway.ts` sets everything below except the secrets.

| Service    | Start command               | Networking                       | `PORT` | Pre-deploy                     |
| ---------- | --------------------------- | -------------------------------- | ------ | ------------------------------ |
| `web`      | `node server.js`            | public HTTPS domain, target 3000 | 3000   | `node dist/db/migrate_cli.mjs` |
| `worker`   | `node dist/worker/main.mjs` | private, no domain               | 4100   | none                           |
| `collab`   | `node dist/collab/main.mjs` | public `wss` domain, target 4200 | 4200   | none                           |
| `Postgres` | Railway's Postgres          | private network                  |        |                                |

`${{...}}` values are Railway references, resolved at deploy time. Secrets are set by the owner
(step 3 below) and never committed or pasted anywhere.

| Variable                       | `web`                                     | `worker`                     | `collab`                     | Secret? |
| ------------------------------ | ----------------------------------------- | ---------------------------- | ---------------------------- | ------- |
| `DATABASE_URL`                 | `${{Postgres.DATABASE_URL}}`              | `${{Postgres.DATABASE_URL}}` | `${{Postgres.DATABASE_URL}}` | (ref)   |
| `PORT`                         | `3000`                                    | `4100`                       | `4200`                       | no      |
| `AUTH_SECRET`                  | set by owner                              |                              | `${{web.AUTH_SECRET}}`       | yes     |
| `SEED_PASSWORD`                | set by owner                              |                              |                              | yes     |
| `ANTHROPIC_API_KEY`            | set by owner (AI assist)                  | `${{web.ANTHROPIC_API_KEY}}` |                              | yes     |
| `COLLAB_URL`                   | `wss://${{collab.RAILWAY_PUBLIC_DOMAIN}}` |                              |                              | no      |
| `ASSIST_MODEL`                 | `claude-haiku-5-5`                        |                              |                              | no      |
| `SPEND_CAP_USD`                | `3`                                       | `3`                          |                              | no      |
| `GENERATION_SPEND_CAP_USD`     | `1`                                       | `1`                          |                              | no      |
| `GENERATION_MODEL`             | `claude-haiku-5-5`                        | `claude-haiku-5-5`           |                              | no      |
| `GENERATION_CONCURRENCY`       | `2`                                       | `2`                          |                              | no      |
| `GENERATION_MAX_ATTEMPTS`      | `2`                                       | `2`                          |                              | no      |
| `GENERATION_EFFORT`            |                                           | `medium`                     |                              | no      |
| `GENERATION_HEARTBEAT_SECONDS` | `60`                                      | `60`                         |                              | no      |
| `DB_POOL_MAX`                  | `10`                                      | `5`                          | `10`                         | no      |
| `PGBOSS_POOL_MAX`              | `2`                                       | `2`                          |                              | no      |

Empty cells: the service doesn't read the variable.

- Every service answers `GET /health` with 200 only when it can reach Postgres (503 otherwise).
  The web route is public, so Railway's health check doesn't need to sign in.
- Only `web` migrates, in its pre-deploy step, so two deploys never migrate at the same time. A
  failed migration stops the web deploy and the previous deployment keeps running.
  `migrate_cli` applies the schema migrations and then the content-id backfill (lessons saved
  before section, part and block ids existed get them; idempotent), so the backfill runs on every
  deploy with no extra step.
- The browser talks to `web` over HTTPS and to `collab` over a WebSocket. `web`, `worker` and
  `collab` only talk to each other through Postgres (pg-boss jobs, NOTIFY), so `worker` needs no
  domain.

## Configuration as code: `.railway/railway.ts`

`.railway/railway.ts` describes the four resources, their build, start, pre-deploy, health check,
restart policy and variables. It uses Railway's Infrastructure as Code (the `railway` npm package,
a dev dependency). `.railway/railway.test.ts` checks it in `npm run check`.

There are no `railway.json` files on purpose: Railway deprecated them, new services can't opt into
them, and Railway stops reading them on 2026-12-01 (D-042).

Secrets are not in the file. `preserve()` means "keep whatever value is set in Railway", so
applying the file never overwrites a secret.

## First deploy (owner)

Needs the Railway CLI 5.42.1 or newer and a clean checkout of `main`.

1. **Create and link the project.** In the repo: `npm install`, `railway login`, then
   `railway init` (new project) or `railway link` (existing empty project).
2. **Create the services.** `railway config plan` shows what will be created (`Postgres`, `web`,
   `worker`, `collab`). Then `railway config apply`.
3. **Set the secrets** (values never go in the repo or in chat). From stdin, without deploying:

   ```sh
   openssl rand -base64 32 | railway variable set AUTH_SECRET --stdin -s web --skip-deploys
   railway variable set SEED_PASSWORD --stdin -s web --skip-deploys       # type it, then Ctrl-D
   railway variable set ANTHROPIC_API_KEY --stdin -s web --skip-deploys   # type it, then Ctrl-D
   ```

   All three are set on `web` only: `collab` reads `AUTH_SECRET` and `worker` reads
   `ANTHROPIC_API_KEY` from `web` through references.

4. **Add public domains.** In the dashboard, open `web` > Settings > Networking > Generate Domain
   (target port 3000), then the same for `collab` (target port 4200). Leave `worker` without one.
   `web`'s `COLLAB_URL` already points at `wss://${{collab.RAILWAY_PUBLIC_DOMAIN}}`.
5. **Deploy the code, `web` first.** The repo isn't on GitHub, so upload it from the checkout.
   `-c` only streams the build and returns before the pre-deploy migration runs, so wait for web
   to finish deploying before starting the others; worker and collab assume the schema exists:

   ```sh
   railway up -s web -c
   railway deployment list -s web   # repeat until the newest one is SUCCESS (migration done)
   railway up -s collab -c && railway up -s worker -c
   ```

   If web's newest deployment is FAILED (build or pre-deploy migration), read its log with
   `railway logs -s web --deployment <id from the list>` and fix it before deploying the others.
   The dashboard shows the same states (web > Deployments: "Pre-deploy" then "Active").

   `.railwayignore` keeps `.env`, `_private/`, `node_modules` and build output out of the upload.
   To deploy from a GitHub mirror instead, set it as each service's source in the dashboard.

6. **Seed once.** It upserts the demo accounts with `SEED_PASSWORD` (the production image refuses
   to seed without it) and loads the standards:

   ```sh
   railway ssh -s web -- node dist/db/seed/seed_cli.mjs
   ```

   Re-running is safe; it resets every demo password to the current `SEED_PASSWORD`.

7. Run the [smoke checklist](#post-deploy-smoke-checklist).

### Two settings to confirm on the first apply

These can only be checked against a real Railway project; the local tests cover the file, not
Railway's behaviour.

- **Secrets kept with `preserve()`.** Expected: on the first apply the secrets don't exist yet, so
  `preserve()` leaves them unset and step 3 sets them; later applies keep them. Check: after step
  3, `railway variable list -s web` lists `AUTH_SECRET`, `SEED_PASSWORD` and
  `ANTHROPIC_API_KEY` (values hidden), and `-s worker` / `-s collab` show the referenced ones. If
  `railway config plan` errors on a missing preserved value, or a later plan shows them being
  removed: set the three secrets in the dashboard (web > Variables > New Variable) first, then
  run `plan` / `apply` again. If the references don't resolve, set `AUTH_SECRET` on collab and
  `ANTHROPIC_API_KEY` on worker to the same values directly.
- **`COLLAB_URL` built from collab's domain.** Expected: web's `COLLAB_URL` resolves to
  `wss://<collab domain>` once collab has a domain (step 4). Check: web > Variables shows the
  resolved value, or `railway variable list -s web`. If it shows an empty host or the literal
  `${{...}}` text: in the dashboard set web's `COLLAB_URL` to `wss://` plus collab's generated
  domain (collab > Settings > Networking), then redeploy web.

Later deploys: `railway up -s <service>` for each changed service. When a change adds a
migration, deploy `web` first and wait for SUCCESS as in step 5 before the others. After
changing `.railway/railway.ts`: `railway config plan`, then `apply`.

## Settings per service (dashboard equivalent)

If you configure a service by hand instead of `railway config apply`, these are the values. Root
directory is the repo root for all three (leave it empty).

| Setting              | `web`                          | `worker`                    | `collab`                    |
| -------------------- | ------------------------------ | --------------------------- | --------------------------- |
| Builder              | Dockerfile                     | Dockerfile                  | Dockerfile                  |
| Dockerfile path      | `Dockerfile`                   | `Dockerfile`                | `Dockerfile`                |
| Custom start command | `node server.js`               | `node dist/worker/main.mjs` | `node dist/collab/main.mjs` |
| Pre-deploy command   | `node dist/db/migrate_cli.mjs` | none                        | none                        |
| Health check path    | `/health`                      | `/health`                   | `/health`                   |
| Health check timeout | 120 s                          | 120 s                       | 120 s                       |
| Restart policy       | On failure, 10 retries         | On failure, 10 retries      | On failure, 10 retries      |
| Draining time        | default                        | 30 s                        | 30 s                        |
| Public domain (port) | Generate (3000)                | none                        | Generate (4200)             |

The worker's draining time lets pg-boss finish or release running jobs; collab's lets Hocuspocus
store open documents before the container stops.

## Notes on the variables

- The image sets `NODE_ENV=production` and `HOSTNAME=0.0.0.0`; don't override them. In production
  `DATABASE_URL` and `SEED_PASSWORD` are required (the processes and the seed fail fast).
- Auth.js needs no `AUTH_URL`: the app sets `trustHost`, so it takes the host and `https` from
  Railway's proxy headers.
- `COLLAB_URL` is read by the web app at request time (`getCollabUrl()`, default
  `ws://localhost:4200`) and handed to the editor, which opens its WebSocket there with a token
  from `GET /api/collab-token`. There is no `NEXT_PUBLIC_COLLAB_URL`: `NEXT_PUBLIC_` values are
  fixed at build time, which would tie the image to one domain.
- Spend guard (R12): `SPEND_CAP_USD` is the total for this database across every generation run
  and AI assist call, so a public URL can spend at most $3 (the reserve in D-038). The web app
  checks it when a run starts and before each assist call, the worker before every job. Raise it
  on purpose for a bigger hosted run. Without `ANTHROPIC_API_KEY`, assist answers 503 and the
  worker logs that generation is disabled.
- Web and worker both create the generation queue, so `GENERATION_HEARTBEAT_SECONDS` and the
  other shared `GENERATION_*` values must match on both. `GENERATION_EFFORT` is the exception: only
  the worker's generation calls read it (assist sets its own effort).
- Hosted demo passwords come from `SEED_PASSWORD`; the README's `demo-password` does not work
  there.

### Postgres connections

`DB_POOL_MAX` sizes each process's pool (default 10) and `PGBOSS_POOL_MAX` pg-boss's own pool
(default 2). Web's live feeds share one dedicated LISTEN connection outside its pool. Collab's
LISTEN for lesson status changes takes one client from its pool, so it has `DB_POOL_MAX` - 1 left
for queries. At most:

| Service       | Formula                                      | With the values above  |
| ------------- | -------------------------------------------- | ---------------------- |
| `web`         | `DB_POOL_MAX` + 1 LISTEN + `PGBOSS_POOL_MAX` | 10 + 1 + 2 = 13        |
| `worker`      | `DB_POOL_MAX` + `PGBOSS_POOL_MAX`            | 5 + 2 = 7              |
| `collab`      | `DB_POOL_MAX` (LISTEN included)              | 10                     |
| migrate, seed | web's `DB_POOL_MAX` while they run           | up to 10               |
| Total         |                                              | 30, 40 during a deploy |

Postgres's default `max_connections` is 100 (check with `SHOW max_connections;`), so this leaves
room for a second web replica or a `psql` session. Keep the total under the limit if you raise a
pool. The worker runs `GENERATION_CONCURRENCY` (2) jobs at a time, so 5 is enough; collab keeps
the default 10 (9 for queries) for the R28 load (25 reviewers). The local smoke run measured 16
connections with two editors open.

## Post-deploy smoke checklist

Replace `<web>` and `<collab>` with the generated domains. Export isn't on `main` yet, so it isn't
in the list.

1. Health, all 200:
   - `curl -s -o /dev/null -w '%{http_code}\n' https://<web>/health`
   - `curl -s -o /dev/null -w '%{http_code}\n' https://<collab>/health`
   - worker: its deployment shows "Healthy" in the dashboard (it has no public domain).
2. Sign in at `https://<web>` as `admin@example.com` with `SEED_PASSWORD`. `demo-password` must
   fail.
3. Import the sample unit (outline and ELD from `data/sample_unit/`); the unit page lists its 41
   lessons.
4. Generate 1 lesson on Haiku (`claude-haiku-5-5`): select it, Generate lessons... > Selected
   lessons > Start generation. It moves to Draft and the run's cost shows on the unit page, well
   under $1. This is a real Anthropic call: get the PM's explicit OK first and record the model,
   tokens and cost for the spend ledger.
5. Two browsers (two accounts) open the lesson: each shows the other as also editing, the network
   tab shows a `wss://<collab>` connection, and each browser sees the other's typing.
6. As an approver, Submit for review, then Approve lesson: the other browser's editor locks
   without a reload ("This lesson is approved, so editing is locked.").

## Checking the image locally

`npm run docker:smoke` builds the image and runs the three services against a throwaway Postgres
the way Railway runs them, with the variables above (compose project `law_deploy_smoke`; host
ports 3920 web, 3921 collab, 3922 worker, 3923 fake model, 3924 Postgres; override with
`SMOKE_*_PORT`). It needs Docker and the Playwright Chromium (`npx playwright install chromium`).

- Pre-deploy and seed: migrates, checks the seed refuses to run without `SEED_PASSWORD`, seeds.
- API checks (`scripts/docker_smoke_checks.ts`): non-root processes, `/health` 200 on all three,
  signed-out redirect and 401, wrong and README passwords refused, sign-in with
  `SEED_PASSWORD`, collab tokens from web, collab refusing a bad token and a non-lesson document.
- Browser flow (`scripts/docker_smoke_flow.ts`): imports the sample unit, generates lessons 1-3
  through the worker, re-runs `migrate_cli` on a lesson stripped of its ids and checks the
  backfill restores them, opens lesson 1 in two browsers through web's `COLLAB_URL`, co-edits,
  counts Postgres connections, then submits and approves and checks the other editor locks live
  and both edits are saved.

The model is a fake Anthropic API the flow starts on the host (`tests/e2e/fake_anthropic.ts`
writing lessons with `tests/e2e/fake_llm.ts`). Web and worker reach it through
`ANTHROPIC_BASE_URL` with the key `smoke-fake-key`, so the real adapter runs and no call can
reach Anthropic. Everything is removed afterwards (`SMOKE_KEEP=1` keeps the containers);
screenshots go to `test-results/docker_smoke/`.

## Troubleshooting

- **Health 503:** the service can't reach Postgres. Check its `DATABASE_URL` reference.
- **Pre-deploy failed:** read the web deploy log; the previous deployment keeps serving.
- **Worker or collab errors about missing tables:** they started before web's migration finished.
  Wait for web's deployment to succeed, then `railway deployment redeploy -s worker` (and
  `-s collab`).
- **Sign-in returns to the sign-in page:** `AUTH_SECRET` is missing on `web`.
- **Editor can't connect:** `collab` has no public domain, its target port isn't 4200, or
  `AUTH_SECRET` differs between `web` and `collab` (collab rejects the token).
- **Generation never starts:** `ANTHROPIC_API_KEY` doesn't resolve on `worker` (its log says
  generation is disabled), or the spend cap is reached (the unit shows "stopped: spend cap
  reached").
- **Too many connections:** lower `DB_POOL_MAX` (see Postgres connections).
