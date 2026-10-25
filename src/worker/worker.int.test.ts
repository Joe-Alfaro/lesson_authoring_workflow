import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest'
import { NOOP_QUEUE, startWorker, type RunningWorker } from './worker'

describe('worker process', () => {
  let worker: RunningWorker

  beforeAll(async () => {
    worker = await startWorker({ databaseUrl: inject('databaseUrl'), port: 0 })
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
    const id = await worker.boss.send(NOOP_QUEUE, { hello: 'world' })
    expect(id).toBeTruthy()
    await expect
      .poll(async () => (await worker.boss.getJobById(NOOP_QUEUE, id ?? ''))?.state, {
        timeout: 15_000,
        interval: 250,
      })
      .toBe('completed')
  })
})
