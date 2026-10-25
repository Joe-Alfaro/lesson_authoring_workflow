# Lesson authoring workflow

AI-assisted generation, review, editing and approval of standards-aligned lesson content.

One npm package with three processes:

| Process | Entry point          | Local port | What it does                                        |
| ------- | -------------------- | ---------- | --------------------------------------------------- |
| web     | `src/app` (Next.js)  | 3000       | UI, API routes, Auth.js sign-in                     |
| worker  | `src/worker/main.ts` | 4100       | pg-boss job worker (lesson generation from M2)      |
| collab  | `src/collab/main.ts` | 4200       | Hocuspocus (Yjs) server, documents kept in Postgres |

Each process reads `PORT` and `DATABASE_URL` from the environment and answers `GET /health` with
200 only when it can reach the database (503 otherwise).

The worker keeps answering `/health` with 503 and retries starting its queue (with backoff) while
the database is unreachable, rather than exiting.

The collab server only accepts connections that present a collab token. Signed-in users get one
from `GET /api/collab-token` (valid for 10 minutes, signed with `AUTH_SECRET`), so web and collab
must share the same `AUTH_SECRET`.

## Requirements

- Node 24 and npm
- Docker (for the local Postgres 16 and the integration tests)

## Setup from a clean clone

```sh
cp .env.example .env
# Set AUTH_SECRET in .env, for example to the output of: openssl rand -base64 32
docker compose up -d --wait   # Postgres 16 on localhost:5432 (set POSTGRES_PORT in .env to change)
npm install
npm run db:migrate
npm run db:seed
npm run dev                   # web, worker and collab together
```

Open http://localhost:3000 and sign in with a demo account.

With `DATABASE_URL` empty, every process uses the compose database
(`postgres://postgres:postgres@localhost:${POSTGRES_PORT:-5432}/lesson_authoring`). Leave `PORT`
unset locally so the three processes keep their own ports.

## Demo accounts (local only)

`npm run db:seed` creates these accounts. Their password is `SEED_PASSWORD`, or `demo-password`
when that is unset. The default is for local development only: in production `SEED_PASSWORD` is
required and the seed refuses to run without it.

| Role     | Emails                                                   |
| -------- | -------------------------------------------------------- |
| admin    | `admin@example.com`                                      |
| author   | `author01@example.com`, `author02@example.com`           |
| approver | `approver01@example.com`, `approver02@example.com`       |
| reviewer | `reviewer01@example.com` … `reviewer20@example.com` (20) |

Re-running the seed is safe: it upserts the accounts (resetting their password to the current
`SEED_PASSWORD`) and the standards.

## Hosted demo (Railway)

One `Dockerfile` builds the image for all three processes; `.railway/railway.ts` configures the
Railway services. Setup, variables per service, the one-time seed and the post-deploy checklist
are in [docs/deploy.md](docs/deploy.md).

## Standards reference data

The seed loads every `data/standards/*.json` file when the directory exists. Each file is an array
of `{ "code", "framework": "CCSS_ELA" | "CA_ELD", "grade", "strand", "text" }`. Standards are
upserted by code.

## Scripts

| Script                                                | What it does                                                    |
| ----------------------------------------------------- | --------------------------------------------------------------- |
| `npm run dev`                                         | Runs web, worker and collab with reload                         |
| `npm run dev:web` / `dev:worker` / `dev:collab`       | Runs one process                                                |
| `npm run build`                                       | Production build: `next build` (standalone) and `dist/` bundles |
| `npm run start:web` / `start:worker` / `start:collab` | Runs one production process after `npm run build`               |
| `npm run db:generate`                                 | Writes a new migration in `drizzle/` from `src/db/schema.ts`    |
| `npm run db:migrate`                                  | Applies migrations                                              |
| `npm run db:seed`                                     | Seeds demo accounts and standards                               |
| `npm run check`                                       | Format check, lint, type check, unit and integration tests      |
| `npm run test:unit` / `test:integration`              | One test project                                                |
| `npm run test:e2e`                                    | Playwright end-to-end tests (see `tests/e2e/README.md`)         |
| `npm run docker:smoke`                                | Builds the production image and smoke-tests all three services  |

Integration tests (`*.int.test.ts`) start a throwaway Postgres 16 container with Testcontainers,
so Docker must be running. To use an existing empty database instead, set `TEST_DATABASE_URL`.
