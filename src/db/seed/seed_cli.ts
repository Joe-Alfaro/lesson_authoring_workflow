import { getSeedPassword } from '../../config/env'
import { loadLocalEnv } from '../../config/load_env'
import { createDb, createPool } from '../client'
import { seed } from './seed'

loadLocalEnv()
const pool = createPool()
try {
  const result = await seed(createDb(pool), { password: getSeedPassword() })
  console.log(`Seeded ${result.users} users and ${result.standards} standards`)
} finally {
  await pool.end()
}
