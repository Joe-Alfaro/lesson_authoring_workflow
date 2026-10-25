# Deploying to Railway (R31)

The hosted demo runs as three Railway services built from this repo, plus a Railway Postgres. The
owner creates the Railway project, the database and the secrets. This page lists every setting.

## What runs where

All three services build the same `Dockerfile`. The image holds Next.js's standalone server and
esbuild bundles of the other processes, runs as the non-root `node` user and is about 220 MB. Each
service picks its process with its start command.

| Service    | Start command               | Public?                | `PORT` | Pre-deploy                     |
| ---------- | --------------------------- | ---------------------- | ------ | ------------------------------ |
| `web`      | `node server.js`            | Yes (HTTPS domain)     | 3000   | `node dist/db/migrate_cli.mjs` |
| `worker`   | `node dist/worker/main.mjs` | No                     | 4100   | none                           |
| `collab`   | `node dist/collab/main.mjs` | Yes (WebSocket, `wss`) | 4200   | none                           |
| `Postgres` | Railway's Postgres          | No (private network)   |        |                                |

- Every service answers `GET /health` with 200 only when it can reach Postgres (503 otherwise).
  The web route is public, so Railway's health check doesn't need to sign in.
- Only `web` migrates, in its pre-deploy step, so two deploys never migrate at the same time. A
  failed migration stops the web deploy and the previous deployment keeps running.
- The browser talks to `web` over HTTPS and to `collab` over a WebSocket. `web`, `worker` and
  `collab` only talk to each other through Postgres, so `worker` needs no domain.

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
   railway variable set SEED_PASSWORD --stdin -s web --skip-deploys   # type it, then Ctrl-D
   railway variable set ANTHROPIC_API_KEY --stdin -s worker --skip-deploys
   ```

   `collab` reads `AUTH_SECRET` from `web` through a reference, so it's set once.

4. **Add public domains.** In the dashboard, open `web` > Settings > Networking > Generate Domain
   (target port 3000), then the same for `collab` (target port 4200). Leave `worker` without one.
   `web`'s `COLLAB_URL` already points at `wss://${{collab.RAILWAY_PUBLIC_DOMAIN}}`.
5. **Deploy the code.** The repo isn't on GitHub, so upload it from the checkout, `web` first so
   it migrates before the others start:

   ```sh
   railway up -s web -c && railway up -s collab -c && railway up -s worker -c
   ```

   `.railwayignore` keeps `.env`, `_private/`, `node_modules` and build output out of the upload.
   To deploy from a GitHub mirror instead, set it as each service's source in the dashboard.

6. **Seed once.** It upserts the demo accounts with `SEED_PASSWORD` (the production image refuses
   to seed without it) and loads the standards:

   ```sh
   railway ssh -s web -- node dist/db/seed/seed_cli.mjs
   ```

   Re-running is safe; it resets every demo password to the current `SEED_PASSWORD`.

7. Run the [smoke checklist](#post-deploy-smoke-checklist).

Later deploys: `railway up -s <service>` for each changed service (`web` first when there is a new
migration). After changing `.railway/railway.ts`: `railway config plan`, then `apply`.

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

## Variables per service

`${{...}}` values are Railway references, resolved at deploy time. Secrets are marked; set them as
in step 3 and never commit or paste them.

| Variable                   | `web`                                     | `worker`                     | `collab`                     | Secret? |
| -------------------------- | ----------------------------------------- | ---------------------------- | ---------------------------- | ------- |
| `DATABASE_URL`             | `${{Postgres.DATABASE_URL}}`              | `${{Postgres.DATABASE_URL}}` | `${{Postgres.DATABASE_URL}}` | (ref)   |
| `PORT`                     | `3000`                                    | `4100`                       | `4200`                       | no      |
| `AUTH_SECRET`              | set by owner                              | not used                     | `${{web.AUTH_SECRET}}`       | yes     |
| `SEED_PASSWORD`            | set by owner                              | not used                     | not used                     | yes     |
| `COLLAB_URL`               | `wss://${{collab.RAILWAY_PUBLIC_DOMAIN}}` | not used                     | not used                     | no      |
| `ANTHROPIC_API_KEY`        | not used                                  | set by owner                 | not used                     | yes     |
| `SPEND_CAP_USD`            | `3`                                       | `3`                          | not used                     | no      |
| `GENERATION_SPEND_CAP_USD` | `1`                                       | `1`                          | not used                     | no      |
| `GENERATION_MODEL`         | `claude-haiku-5-5`                        | `claude-haiku-5-5`           | not used                     | no      |
| `GENERATION_CONCURRENCY`   | `2`                                       | `2`                          | not used                     | no      |
| `GENERATION_MAX_ATTEMPTS`  | `2`                                       | `2`                          | not used                     | no      |
| `GENERATION_EFFORT`        | `medium`                                  | `medium`                     | not used                     | no      |

Notes:

- The image sets `NODE_ENV=production` and `HOSTNAME=0.0.0.0`; don't override them. In production
  `DATABASE_URL` and `SEED_PASSWORD` are required (the processes and the seed fail fast).
- Auth.js needs no `AUTH_URL`: the app sets `trustHost`, so it takes the host and `https` from
  Railway's proxy headers.
- `COLLAB_URL` is read by the web app at request time and handed to the editor, so the same image
  works anywhere. It isn't a `NEXT_PUBLIC_` variable because those are fixed at build time.
- Spend guard (R12): the web app checks `SPEND_CAP_USD` when a run starts, the worker before every
  job. It is the total for this database across all runs, so a public URL can spend at most $3
  (the reserve in D-038). Raise it on purpose for a bigger hosted run. Only the worker has the
  Anthropic key.
- Hosted demo passwords come from `SEED_PASSWORD`; the README's `demo-password` does not work
  there.

## Post-deploy smoke checklist

Replace `<web>` and `<collab>` with the generated domains.

1. Health, all 200:
   - `curl -s -o /dev/null -w '%{http_code}\n' https://<web>/health`
   - `curl -s -o /dev/null -w '%{http_code}\n' https://<collab>/health`
   - worker: its deployment shows "Healthy" in the dashboard (it has no public domain).
2. Sign in at `https://<web>` as `admin@example.com` with `SEED_PASSWORD`. `demo-password` must
   fail.
3. Import the sample unit (outline and ELD from `data/sample_unit/`); the unit page lists its
   lessons.
4. Generate 1 lesson on Haiku (`claude-haiku-5-5`): it moves to Draft and the run's cost shows on
   the unit page, well under $1.
5. Two browsers (two accounts) open the same lesson: the network tab shows a `wss://<collab>`
   connection and each browser sees the other's edits.
6. Approve the lesson as an approver: it locks for editing.

## Checking the image locally

`npm run docker:smoke` builds the image and runs it the way Railway does, against a throwaway
Postgres (compose project `law_deploy_smoke`, host ports 3920-3922, override with
`SMOKE_WEB_PORT`, `SMOKE_COLLAB_PORT`, `SMOKE_WORKER_PORT`). It migrates, checks the seed refuses
to run without `SEED_PASSWORD`, seeds, starts the three services, checks they run as non-root and
that `/health` is 200 on each, signs in, checks the README password fails, gets collab tokens from
the web app and has two users edit one document through the web app's `COLLAB_URL`. It never calls
the model and removes everything afterwards (`SMOKE_KEEP=1` keeps the containers).

## Troubleshooting

- **Health 503:** the service can't reach Postgres. Check its `DATABASE_URL` reference.
- **Pre-deploy failed:** read the web deploy log; the previous deployment keeps serving.
- **Sign-in returns to the sign-in page:** `AUTH_SECRET` is missing on `web`.
- **Editor can't connect:** `collab` has no public domain, its target port isn't 4200, or
  `AUTH_SECRET` differs between `web` and `collab` (collab rejects the token).
- **Generation never starts:** `ANTHROPIC_API_KEY` is missing on `worker` (its log says so), or the
  spend cap is reached (the unit shows "stopped: spend cap reached").
