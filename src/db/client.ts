import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { getDatabaseUrl } from '../config/env'
import * as schema from './schema'

export type Database = NodePgDatabase<typeof schema>

export function createPool(connectionString = getDatabaseUrl()): pg.Pool {
  return new pg.Pool({ connectionString, connectionTimeoutMillis: 5_000 })
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
