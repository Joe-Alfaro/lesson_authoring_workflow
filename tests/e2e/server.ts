/**
 * Playwright's webServer: starts a throwaway Postgres (or uses E2E_DATABASE_URL, which must point
 * at an empty database), migrates and seeds it, starts the collab server (M3) and a fake Anthropic
 * API (M4 AI assist) in this process and runs `next dev` against them. Stops everything when Playwright stops this process.
 */
import { spawn } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { createDb, createPool } from '../../src/db/client'
import { runMigrations } from '../../src/db/migrate'
import { seed } from '../../src/db/seed/seed'
import { startCollabServer } from '../../src/collab/server'
import { startFakeAnthropic } from './fake_anthropic'
import {
  E2E_AUTH_SECRET,
  E2E_COLLAB_PORT,
  E2E_COLLAB_URL,
  E2E_FAKE_LLM_PORT,
  E2E_FAKE_LLM_URL,
  E2E_PORT,
  E2E_SEED_PASSWORD,
  E2E_SPEND_CAP_USD,
  E2E_STATE_FILE,
  type E2eState,
} from './env'

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

const databaseUrl = await startDatabase()
await prepare(databaseUrl)
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
    // AI assist talks to the fake API through the real adapter; never pass the developer's key
    // to the app under test.
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
    await fakeLlm.stop().catch(() => undefined)
    rmSync(E2E_STATE_FILE, { force: true })
    await container?.stop().catch(() => undefined)
  }
  process.exit(code)
}

next.on('exit', (code) => void stop(code ?? 0))
process.on('SIGTERM', () => void stop(0))
process.on('SIGINT', () => void stop(0))
