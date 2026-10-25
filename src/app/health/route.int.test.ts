import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest'

describe('GET /health', () => {
  beforeAll(() => {
    process.env.DATABASE_URL = inject('databaseUrl')
  })
  afterAll(async () => {
    const { getPool } = await import('../../db/client')
    await getPool().end()
  })

  it('returns 200 when the database is reachable', async () => {
    const { GET } = await import('./route')
    const response = await GET()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok', database: 'up' })
  })
})
