import { afterAll, describe, expect, it } from 'vitest'
import { inject } from 'vitest'
import { createPool } from '../db/client'
import { checkHealth } from '../db/health'

// A port nothing listens on, so connecting fails fast.
const UNREACHABLE_URL = 'postgres://postgres:postgres@127.0.0.1:1/none'

describe('checkHealth', () => {
  const up = createPool(inject('databaseUrl'))
  const down = createPool(UNREACHABLE_URL)
  afterAll(async () => {
    await Promise.all([up.end(), down.end()])
  })

  it('reports ok when the database answers', async () => {
    expect(await checkHealth(up)).toEqual({ status: 'ok', database: 'up' })
  })

  it('reports unavailable when the database cannot be reached', async () => {
    expect(await checkHealth(down)).toEqual({ status: 'unavailable', database: 'down' })
  })
})
