import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Port for the app under test (`E2E_PORT`, default 3410); away from the dev default (3000) and
 * from 3100, which another local app uses.
 */
export const E2E_PORT = Number(process.env.E2E_PORT ?? 3410)

export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`

/** Port of the collab server the e2e run starts next to the app (`E2E_COLLAB_PORT`, default 3411). */
export const E2E_COLLAB_PORT = Number(process.env.E2E_COLLAB_PORT ?? E2E_PORT + 1)

/** What the browser connects to; the app gets it as `COLLAB_URL`. */
export const E2E_COLLAB_URL = `ws://localhost:${E2E_COLLAB_PORT}`

/** Test-only Auth.js secret; the e2e server never uses the developer's `.env` secret. */
export const E2E_AUTH_SECRET = 'e2e-only-auth-secret-not-for-any-real-deployment'

/** Password of the seeded demo accounts in the e2e database. */
export const E2E_SEED_PASSWORD = 'demo-password'

/** Where server.ts records the database URL so the specs can reset and inspect it. */
export const E2E_STATE_FILE = join(tmpdir(), `lesson_authoring_e2e_${E2E_PORT}.json`)

export interface E2eState {
  databaseUrl: string
}
