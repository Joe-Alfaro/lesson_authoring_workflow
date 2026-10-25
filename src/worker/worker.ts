import type { AddressInfo } from 'node:net'
import { PgBoss } from 'pg-boss'
import { createPool } from '../db/client'
import { createHealthServer } from '../health/server'
import { retryWithBackoff, type RetryOptions } from './retry'

/** Placeholder queue that proves the worker is consuming jobs; M2 adds the generation queue. */
export const NOOP_QUEUE = 'noop'

export interface WorkerOptions {
  databaseUrl: string
  port: number
  retry?: Pick<RetryOptions, 'initialDelayMs' | 'maxDelayMs'>
}

export interface RunningWorker {
  url: string
  /** Resolves with the started pg-boss once the database is reachable. */
  ready: Promise<PgBoss>
  stop(): Promise<void>
}

async function startBoss(databaseUrl: string): Promise<PgBoss> {
  // A fresh instance per attempt: a failed start() leaves pg-boss half-initialized.
  const boss = new PgBoss({ connectionString: databaseUrl })
  boss.on('error', (error) => console.error('[worker] pg-boss error', error))
  try {
    await boss.start()
    await boss.createQueue(NOOP_QUEUE)
    await boss.work(NOOP_QUEUE, async (jobs) => {
      jobs.forEach((job) => console.log(`[worker] no-op job ${job.id}`))
    })
    return boss
  } catch (error) {
    await boss.stop({ graceful: false }).catch(() => undefined)
    throw error
  }
}

/**
 * Serves /health immediately, then starts pg-boss, retrying with backoff while the database is
 * unreachable, so a deploy with the database down reports 503 instead of crash-looping.
 */
export async function startWorker(options: WorkerOptions): Promise<RunningWorker> {
  const pool = createPool(options.databaseUrl)
  const abort = new AbortController()
  let boss: PgBoss | undefined

  const ready = retryWithBackoff(() => startBoss(options.databaseUrl), {
    initialDelayMs: options.retry?.initialDelayMs ?? 1_000,
    maxDelayMs: options.retry?.maxDelayMs ?? 30_000,
    signal: abort.signal,
    onRetry: (error, delayMs) => {
      // Connection failures arrive as an AggregateError with an empty message; fall back to its code.
      const { message, code } = (error ?? {}) as { message?: string; code?: string }
      const reason = message || code || String(error)
      console.error(`[worker] pg-boss start failed (${reason}); retrying in ${delayMs} ms`)
    },
  }).then((started) => {
    boss = started
    return started
  })
  // stop() before the database comes up rejects `ready` with an abort; that is expected.
  ready.catch(() => undefined)

  const server = createHealthServer(pool, () => boss !== undefined)
  await new Promise<void>((resolve) => server.listen(options.port, resolve))
  const { port } = server.address() as AddressInfo

  return {
    url: `http://localhost:${port}`,
    ready,
    async stop() {
      abort.abort()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
      await boss?.stop({ graceful: true })
      await pool.end()
    },
  }
}
