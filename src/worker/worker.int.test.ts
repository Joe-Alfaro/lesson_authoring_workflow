import type { PgBoss } from 'pg-boss'
import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest'
import { NOOP_QUEUE, startWorker, type RunningWorker } from './worker'

describe('worker process', () => {
  let worker: RunningWorker
  let boss: PgBoss

  beforeAll(async () => {
    worker = await startWorker({ databaseUrl: inject('databaseUrl'), port: 0 })
    boss = await worker.ready
  })
  afterAll(async () => {
    await worker.stop()
  })

  it('serves GET /health with 200 when the database is reachable', async () => {
    const response = await fetch(`${worker.url}/health`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok', database: 'up' })
  })

  it('returns 404 for other paths', async () => {
    const response = await fetch(`${worker.url}/other`)
    expect(response.status).toBe(404)
  })

  it('completes jobs on the no-op queue', async () => {
    const id = await boss.send(NOOP_QUEUE, { hello: 'world' })
    expect(id).toBeTruthy()
    await expect
      .poll(async () => (await boss.getJobById(NOOP_QUEUE, id ?? ''))?.state, {
        timeout: 15_000,
        interval: 250,
      })
      .toBe('completed')
  })
})

describe('worker process without a database', () => {
  it('serves /health 503 and keeps retrying instead of crashing', async () => {
    const worker = await startWorker({
      databaseUrl: 'postgres://postgres:postgres@127.0.0.1:1/none',
      port: 0,
      retry: { initialDelayMs: 20, maxDelayMs: 50 },
    })
    try {
      const response = await fetch(`${worker.url}/health`)
      expect(response.status).toBe(503)
      expect(await response.json()).toEqual({ status: 'unavailable', database: 'down' })

      // Several retries later it is still up and still unhealthy.
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect((await fetch(`${worker.url}/health`)).status).toBe(503)
    } finally {
      await worker.stop()
    }
  })
})
