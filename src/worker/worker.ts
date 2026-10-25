import type { AddressInfo } from 'node:net'
import { PgBoss } from 'pg-boss'
import { createPool } from '../db/client'
import { createHealthServer } from '../health/server'

/** Placeholder queue that proves the worker is consuming jobs; M2 adds the generation queue. */
export const NOOP_QUEUE = 'noop'

export interface WorkerOptions {
  databaseUrl: string
  port: number
}

export interface RunningWorker {
  boss: PgBoss
  url: string
  stop(): Promise<void>
}

export async function startWorker(options: WorkerOptions): Promise<RunningWorker> {
  const pool = createPool(options.databaseUrl)
  const boss = new PgBoss({ connectionString: options.databaseUrl })
  boss.on('error', (error) => console.error('[worker] pg-boss error', error))
  await boss.start()
  await boss.createQueue(NOOP_QUEUE)
  await boss.work(NOOP_QUEUE, async (jobs) => {
    jobs.forEach((job) => console.log(`[worker] no-op job ${job.id}`))
  })

  const server = createHealthServer(pool)
  await new Promise<void>((resolve) => server.listen(options.port, resolve))
  const { port } = server.address() as AddressInfo

  return {
    boss,
    url: `http://localhost:${port}`,
    async stop() {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
      await boss.stop({ graceful: true })
      await pool.end()
    },
  }
}
