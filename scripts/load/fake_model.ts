/**
 * A stand-in for the Anthropic Messages API for the R29 throughput run: the production worker
 * keeps its real Anthropic adapter and reaches this server through ANTHROPIC_BASE_URL, so the run
 * exercises the real queue, worker, validation and database writes without calling a model.
 *
 * Each request waits a random FAKE_MODEL_DELAY_MS (a range "min-max", default 60000-90000: the
 * per-lesson times measured in the real runs, see docs/performance.md), then streams a valid
 * lesson for the prompt's lesson (tests/e2e/fake_llm.ts) with the token counts of the cost
 * estimate. Env: FAKE_MODEL_PORT (3764).
 */
import { ESTIMATED_TOKENS_PER_LESSON } from '../../src/generation/llm'
import { startFakeAnthropic } from '../../tests/e2e/fake_anthropic'
import { fakeLessonBody } from '../../tests/e2e/fake_llm'
import { between, env, envNumber } from './support'

const port = envNumber('FAKE_MODEL_PORT', 3764)
const range = env('FAKE_MODEL_DELAY_MS', '60000-90000')
const match = /^(\d+)(?:-(\d+))?$/.exec(range)
if (!match) throw new Error('FAKE_MODEL_DELAY_MS must be "ms" or "min-max"')
const minMs = Number(match[1])
const maxMs = Number(match[2] ?? match[1])

let calls = 0
const server = await startFakeAnthropic(port, {
  answer(request) {
    calls += 1
    const delayMs = between(minMs, maxMs)
    console.log(`[fake-model] call ${calls}: answering in ${(delayMs / 1000).toFixed(1)} s`)
    return {
      output: fakeLessonBody({ ...request, schema: {} }),
      delayMs,
      usage: ESTIMATED_TOKENS_PER_LESSON,
    }
  },
})
console.log(`[fake-model] listening on http://localhost:${port} (delay ${minMs}-${maxMs} ms)`)

function shutdown() {
  void server.stop().then(() => process.exit(0))
}
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
