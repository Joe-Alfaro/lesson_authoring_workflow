import { getDatabaseUrl, getPort } from '../config/env'
import { loadLocalEnv } from '../config/load_env'
import { startCollabServer } from './server'

loadLocalEnv()
const collab = await startCollabServer({ databaseUrl: getDatabaseUrl(), port: getPort(4200) })
console.log(`[collab] running, health at ${collab.url}/health`)

function shutdown() {
  collab.stop().then(
    () => process.exit(0),
    (error: unknown) => {
      console.error('[collab] shutdown failed', error)
      process.exit(1)
    },
  )
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
