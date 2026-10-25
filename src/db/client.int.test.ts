import { afterAll, describe, expect, inject, it } from 'vitest'
import { createPool } from './client'
import { checkHealth } from './health'

describe('createPool', () => {
  const url = new URL(inject('databaseUrl'))
  url.searchParams.set('application_name', 'pool_error_test')
  const pool = createPool(url.toString())
  const admin = createPool(inject('databaseUrl'))
  afterAll(async () => {
    await Promise.all([pool.end(), admin.end()])
  })

  it('survives the server dropping an idle connection and recovers', async () => {
    await pool.query('select 1')
    expect(pool.idleCount).toBe(1)

    await admin.query(
      `select pg_terminate_backend(pid) from pg_stat_activity
       where application_name = 'pool_error_test'`,
    )
    // Without an 'error' listener on the pool, this drop crashes the process.
    await expect.poll(() => pool.idleCount).toBe(0)

    expect(await checkHealth(pool)).toEqual({ status: 'ok', database: 'up' })
  })
})
