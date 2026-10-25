import { getDatabaseUrl, getPort } from '../config/env'
import { loadLocalEnv } from '../config/load_env'
import { createAnthropicLlmClient } from '../generation/anthropic_client'
import { getGenerationSettings } from '../generation/settings'
import { startWorker } from './worker'

loadLocalEnv()
const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
if (!apiKey) {
  console.warn('[worker] ANTHROPIC_API_KEY is not set; lesson generation is disabled')
}
const worker = await startWorker({
  databaseUrl: getDatabaseUrl(),
  port: getPort(4100),
  generation: apiKey
    ? { llm: createAnthropicLlmClient({ apiKey }), settings: getGenerationSettings() }
    : undefined,
})
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
