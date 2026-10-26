import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { getDatabaseUrl, getDbPoolMax } from '../config/env'
import * as schema from './schema'

export type Database = NodePgDatabase<typeof schema>

export function createPool(
  connectionString = getDatabaseUrl(),
  options: { max?: number } = {},
): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    connectionTimeoutMillis: 5_000,
    max: options.max ?? getDbPoolMax(),
  })
  // An idle client dropped by the server (restart, failover) emits 'error' on the pool; without a
  // listener that crashes the process. The pool discards the client and reconnects on demand.
  pool.on('error', (error) => {
    console.error('[db] idle client error:', error.message)
  })
  return pool
}

export function createDb(pool: pg.Pool): Database {
  return drizzle(pool, { schema })
}

interface AppDbGlobal {
  appPool?: pg.Pool
  appDb?: Database
}

const appGlobal = globalThis as AppDbGlobal

/** Process-wide pool, reused across Next.js hot reloads. */
export function getPool(): pg.Pool {
  appGlobal.appPool ??= createPool()
  return appGlobal.appPool
}

export function getDb(): Database {
  appGlobal.appDb ??= createDb(getPool())
  return appGlobal.appDb
}
