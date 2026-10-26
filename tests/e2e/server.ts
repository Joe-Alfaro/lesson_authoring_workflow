/**
 * Playwright's webServer: starts a throwaway Postgres (or uses E2E_DATABASE_URL, which must point
 * at an empty database), migrates and seeds it, starts in this process the collab server (M3), the
 * generation worker with a fake LLM client (D-036) and a fake Anthropic API for AI assist (D-046),
 * and runs `next dev` against them. Stops everything when Playwright stops this process.
 */
import { spawn } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { PgBoss } from 'pg-boss'
import { createDb, createPool } from '../../src/db/client'
import { runMigrations } from '../../src/db/migrate'
import { seed } from '../../src/db/seed/seed'
import { startCollabServer } from '../../src/collab/server'
import { registerGenerationWorker } from '../../src/generation/worker'
import { startFakeAnthropic } from './fake_anthropic'
import {
  E2E_AUTH_SECRET,
  E2E_COLLAB_PORT,
  E2E_COLLAB_URL,
  E2E_FAKE_LLM_PORT,
  E2E_FAKE_LLM_URL,
  E2E_GENERATION_ENV,
  E2E_PORT,
  E2E_SEED_PASSWORD,
  E2E_SPEND_CAP_USD,
  E2E_STATE_FILE,
  type E2eState,
} from './env'
import { createE2eFakeLlm } from './fake_llm'

let container: StartedPostgreSqlContainer | undefined

async function startDatabase(): Promise<string> {
  const existing = process.env.E2E_DATABASE_URL?.trim()
  if (existing) {
    return existing
  }
  const labels: Record<string, string> = {}
  if (process.env.AO_SESSION_ID) {
    labels['ao.session'] = process.env.AO_SESSION_ID
  }
  container = await new PostgreSqlContainer('postgres:16-alpine').withLabels(labels).start()
  return container.getConnectionUri()
}

async function prepare(databaseUrl: string): Promise<void> {
  const pool = createPool(databaseUrl)
  try {
    await runMigrations(pool)
    await seed(createDb(pool), { password: E2E_SEED_PASSWORD })
  } finally {
    await pool.end()
  }
}

/**
 * The generation worker of the e2e app: the real pg-boss worker with the fake LLM client
 * (tests/e2e/fake_llm.ts), so runs started from the UI generate lessons without a model provider.
 */
async function startFakeGenerationWorker(databaseUrl: string): Promise<() => Promise<void>> {
  const pool = createPool(databaseUrl)
  const boss = new PgBoss({ connectionString: databaseUrl })
  boss.on('error', (error) => console.error('[e2e worker] pg-boss error', error))
  await boss.start()
  const worker = await registerGenerationWorker({
    db: createDb(pool),
    boss,
    llm: createE2eFakeLlm({ delayMs: Number(process.env.E2E_FAKE_LLM_DELAY_MS ?? 1000) }),
    concurrency: Number(E2E_GENERATION_ENV.GENERATION_CONCURRENCY),
    maxAttempts: Number(E2E_GENERATION_ENV.GENERATION_MAX_ATTEMPTS),
    globalCapUsd: Number(E2E_GENERATION_ENV.SPEND_CAP_USD),
    pollingIntervalSeconds: 0.5,
  })
  return async () => {
    await worker.stop().catch(() => undefined)
    await boss.stop({ graceful: false }).catch(() => undefined)
    await pool.end().catch(() => undefined)
  }
}

const databaseUrl = await startDatabase()
await prepare(databaseUrl)
const stopWorker = await startFakeGenerationWorker(databaseUrl)
const state: E2eState = { databaseUrl }
writeFileSync(E2E_STATE_FILE, JSON.stringify(state))

const collab = await startCollabServer({
  databaseUrl,
  port: E2E_COLLAB_PORT,
  authSecret: E2E_AUTH_SECRET,
})

const fakeLlm = await startFakeAnthropic(E2E_FAKE_LLM_PORT)

const next = spawn('npx', ['next', 'dev', '--port', String(E2E_PORT)], {
  stdio: 'inherit',
  env: {
    ...process.env,
    DATABASE_URL: databaseUrl,
    AUTH_SECRET: E2E_AUTH_SECRET,
    SEED_PASSWORD: E2E_SEED_PASSWORD,
    PORT: String(E2E_PORT),
    COLLAB_URL: E2E_COLLAB_URL,
    // Never pass the developer's key to the app. Generation runs on the fake worker above (D-036);
    // AI assist runs in the app and reaches the fake Anthropic API through the real adapter (D-046).
    ...E2E_GENERATION_ENV,
    ANTHROPIC_API_KEY: 'e2e-fake-key',
    ANTHROPIC_BASE_URL: E2E_FAKE_LLM_URL,
    SPEND_CAP_USD: String(E2E_SPEND_CAP_USD),
  },
})

let stopping = false
async function stop(code: number): Promise<never> {
  if (!stopping) {
    stopping = true
    next.kill('SIGTERM')
    await collab.stop().catch(() => undefined)
    await stopWorker()
    await fakeLlm.stop().catch(() => undefined)
    rmSync(E2E_STATE_FILE, { force: true })
    await container?.stop().catch(() => undefined)
  }
  process.exit(code)
}

next.on('exit', (code) => void stop(code ?? 0))
process.on('SIGTERM', () => void stop(0))
process.on('SIGINT', () => void stop(0))
