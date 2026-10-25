import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Port for the app under test (`E2E_PORT`, default 3410); away from the dev default (3000) and
 * from 3100, which another local app uses.
 */
export const E2E_PORT = Number(process.env.E2E_PORT ?? 3410)

export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`

/** Test-only Auth.js secret; the e2e server never uses the developer's `.env` secret. */
export const E2E_AUTH_SECRET = 'e2e-only-auth-secret-not-for-any-real-deployment'

/** Password of the seeded demo accounts in the e2e database. */
export const E2E_SEED_PASSWORD = 'demo-password'

/** Where server.ts records the database URL so the specs can reset and inspect it. */
export const E2E_STATE_FILE = join(tmpdir(), `lesson_authoring_e2e_${E2E_PORT}.json`)

export interface E2eState {
  databaseUrl: string
}

/**
 * Generation settings of the e2e app and its fake worker (src/generation/settings.ts names).
 * The model is the Haiku-class default, so costs use real prices; the fake LLM never calls it.
 */
export const E2E_GENERATION_ENV = {
  GENERATION_MODEL: 'claude-haiku-5-5',
  GENERATION_CONCURRENCY: '4',
  GENERATION_MAX_ATTEMPTS: '2',
  GENERATION_SPEND_CAP_USD: '5',
  SPEND_CAP_USD: '20',
} as const
