import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest'
import { connectTestDb } from '../../tests/db'
import { runMigrations } from '../db/migrate'
import { createYjsPersistence } from './persistence'
import { startCollabServer, type RunningCollab } from './server'

describe('collab process', () => {
  const { pool, db } = connectTestDb()
  let collab: RunningCollab

  beforeAll(async () => {
    await runMigrations(pool)
    collab = await startCollabServer({ databaseUrl: inject('databaseUrl'), port: 0 })
  })
  afterAll(async () => {
    await collab.stop()
    await pool.end()
  })

  it('serves GET /health with 200 when the database is reachable', async () => {
    const response = await fetch(`${collab.url}/health`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok', database: 'up' })
  })

  it('persists Yjs document state in Postgres', async () => {
    const persistence = createYjsPersistence(db)
    expect(await persistence.fetch('lesson:missing')).toBeNull()

    await persistence.store('lesson:abc', new Uint8Array([1, 2, 3]))
    await persistence.store('lesson:abc', new Uint8Array([4, 5]))

    expect(await persistence.fetch('lesson:abc')).toEqual(new Uint8Array([4, 5]))
  })
})
