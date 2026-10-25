import { getDatabaseUrl, getPort } from '../config/env'
import { loadLocalEnv } from '../config/load_env'
import { startWorker } from './worker'

loadLocalEnv()
const worker = await startWorker({ databaseUrl: getDatabaseUrl(), port: getPort(4100) })
console.log(`[worker] health at ${worker.url}/health`)
worker.ready.then(
  () => console.log('[worker] pg-boss running'),
  () => undefined,
)

function shutdown() {
  worker.stop().then(
    () => process.exit(0),
    (error: unknown) => {
      console.error('[worker] shutdown failed', error)
      process.exit(1)
    },
  )
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
