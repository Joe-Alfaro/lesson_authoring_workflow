import { inject } from 'vitest'
import { createDb, createPool } from '../src/db/client'

/** Pool and Drizzle client for the integration database started in integration_setup.ts. */
export function connectTestDb() {
  const pool = createPool(inject('databaseUrl'))
  return { pool, db: createDb(pool) }
}
