import { resolve } from 'node:path'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import type pg from 'pg'
import { createDb } from './client'

export const MIGRATIONS_FOLDER = resolve(import.meta.dirname, '../../drizzle')

export async function runMigrations(pool: pg.Pool): Promise<void> {
  await migrate(createDb(pool), { migrationsFolder: MIGRATIONS_FOLDER })
}
