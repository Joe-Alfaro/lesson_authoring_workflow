// The web app's pg-boss client: it only inserts generation jobs; the worker process runs them.
import { PgBoss } from 'pg-boss'
import { getDatabaseUrl, pgBossOptions } from '../config/env'
import { getDb, type Database } from '../db/client'
import { ensureGenerationQueue } from '../generation/queue'
import type { GenerationDeps } from '../generation/service'

interface BossGlobal {
  appBoss?: Promise<PgBoss>
}

const bossGlobal = globalThis as BossGlobal

async function startBoss(): Promise<PgBoss> {
  const boss = new PgBoss(pgBossOptions(getDatabaseUrl()))
  boss.on('error', (error) => console.error('[web] pg-boss error', error))
  await boss.start()
  await ensureGenerationQueue(boss)
  return boss
}

/** Process-wide pg-boss, started on first use and reused across Next.js hot reloads. */
export function getAppBoss(): Promise<PgBoss> {
  bossGlobal.appBoss ??= startBoss().catch((error: unknown) => {
    bossGlobal.appBoss = undefined
    throw error
  })
  return bossGlobal.appBoss
}

/** Service dependencies for a route that queues jobs. */
export async function generationDeps(): Promise<GenerationDeps> {
  return { db: getDb(), boss: await getAppBoss() }
}

/** Estimates and reads never queue anything; using the queue from these deps is a bug. */
const NO_BOSS = new Proxy(
  {},
  {
    get() {
      throw new Error('These generation deps are read-only and have no queue')
    },
  },
) as PgBoss

/** Service dependencies for reads such as estimateRunCost, without starting pg-boss. */
export function readOnlyDeps(db: Database): GenerationDeps {
  return { db, boss: NO_BOSS }
}
