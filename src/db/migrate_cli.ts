import { loadLocalEnv } from '../config/load_env'
import { createPool } from './client'
import { runMigrations } from './migrate'

loadLocalEnv()
const pool = createPool()
try {
  await runMigrations(pool)
  console.log('Migrations applied')
} finally {
  await pool.end()
}
