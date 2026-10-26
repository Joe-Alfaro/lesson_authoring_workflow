import { loadLocalEnv } from '../config/load_env'
import { backfillContentIds } from './backfill_content_ids'
import { createDb, createPool } from './client'
import { runMigrations } from './migrate'

loadLocalEnv()
const pool = createPool()
try {
  await runMigrations(pool)
  console.log('Migrations applied')
  const { updated } = await backfillContentIds(createDb(pool))
  if (updated > 0) console.log(`Gave ${updated} lesson(s) section, part and block ids`)
} finally {
  await pool.end()
}
