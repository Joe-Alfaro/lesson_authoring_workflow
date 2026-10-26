// B1 (M4 validation): many SSE subscribers share one LISTEN connection per process instead of each
// holding a pool client, so open dashboards and editors can't exhaust the app's pool.
import { afterAll, describe, expect, inject, it } from 'vitest'
import { connectTestDb } from '../../tests/db'
import { createPool } from './client'
import { subscribeToChannel } from './notify_hub'

const CHANNEL = 'm4_notify_hub_test'

async function listeningBackends(pool: import('pg').Pool): Promise<number> {
  const result = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM pg_stat_activity WHERE query ILIKE $1`,
    [`LISTEN ${CHANNEL}%`],
  )
  return result.rows[0]!.n
}

describe('notify hub', () => {
  const { pool: observer } = connectTestDb()
  afterAll(() => observer.end())

  it('25 subscribers share one LISTEN connection, get every notification, and leave the pool free', async () => {
    // A small pool: 25 per-subscriber clients could never fit in it.
    const pool = createPool(inject('databaseUrl'), { max: 3 })
    try {
      const received = Array.from({ length: 25 }, () => [] as string[])
      const unsubscribes = await Promise.all(
        received.map((log) => subscribeToChannel(pool, CHANNEL, (payload) => log.push(payload))),
      )
      expect(await listeningBackends(observer)).toBe(1)

      // The pool still answers queries (the subscribers hold none of its clients).
      const answers = await Promise.all(
        Array.from({ length: 6 }, () => pool.query<{ one: number }>('SELECT 1 AS one')),
      )
      expect(answers.map((answer) => answer.rows[0]!.one)).toEqual([1, 1, 1, 1, 1, 1])
      expect(pool.totalCount).toBeLessThanOrEqual(3)

      await observer.query(`SELECT pg_notify($1, 'hello')`, [CHANNEL])
      await expect
        .poll(() => received.every((log) => log.includes('hello')), { timeout: 5_000 })
        .toBe(true)

      await Promise.all(unsubscribes.map((unsubscribe) => unsubscribe()))
      await expect.poll(() => listeningBackends(observer), { timeout: 5_000 }).toBe(0)
    } finally {
      await pool.end()
    }
  })

  it('an unsubscribed listener stops receiving while others keep receiving', async () => {
    const pool = createPool(inject('databaseUrl'), { max: 2 })
    try {
      const first: string[] = []
      const second: string[] = []
      const stopFirst = await subscribeToChannel(pool, CHANNEL, (payload) => first.push(payload))
      const stopSecond = await subscribeToChannel(pool, CHANNEL, (payload) => second.push(payload))
      await stopFirst()
      await observer.query(`SELECT pg_notify($1, 'after')`, [CHANNEL])
      await expect.poll(() => second.includes('after'), { timeout: 5_000 }).toBe(true)
      expect(first).toEqual([])
      await stopSecond()
    } finally {
      await pool.end()
    }
  })
})
