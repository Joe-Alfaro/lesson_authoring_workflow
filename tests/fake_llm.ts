// Fake LlmClient for generation tests. No test ever talks to a real model provider.
import type { LlmClient, LlmRequest, LlmResponse, LlmUsage } from '../src/generation/llm'
import { coreLessonBody } from './fixtures/lesson/lesson_fixture'

/** Model id the tests use; priced by TEST_PRICES. */
export const TEST_MODEL = 'test-model'

/** 1000 input + 1000 output tokens at these prices cost exactly $0.01. */
export const TEST_PRICES = { [TEST_MODEL]: { inputPerMTok: 1, outputPerMTok: 9 } }
export const TEST_USAGE: LlmUsage = { inputTokens: 1000, outputTokens: 1000 }
export const TEST_CALL_COST = 0.01

/**
 * Test lessons put a unique marker in their Text Dependent Question ("Question marker Q7?",
 * "Question marker FLEX1?"). Previous/next lessons contribute only their descriptions to a prompt,
 * so the marker identifies which lesson a request is for.
 */
export function lessonMarker(request: LlmRequest): string | null {
  const match = /Question marker ((?:Q|FLEX)\d+)\?/.exec(`${request.system}\n${request.prompt}`)
  return match ? match[1]! : null
}

export interface FakeLlmCall {
  index: number
  marker: string | null
  request: LlmRequest
  startedAt: number
}

export type FakeRespond = (request: LlmRequest, call: FakeLlmCall) => unknown

export interface FakeLlmOptions {
  /** Returns the structured output (or throws). Default: a valid core lesson body. */
  respond?: FakeRespond
  usage?: LlmUsage
  /** Simulated latency per call. */
  delayMs?: number
}

export interface FakeLlm extends LlmClient {
  calls: FakeLlmCall[]
  callsFor(marker: string): FakeLlmCall[]
  maxInFlight(): number
}

export function createFakeLlm(options: FakeLlmOptions = {}): FakeLlm {
  const calls: FakeLlmCall[] = []
  let inFlight = 0
  let maxInFlight = 0
  const respond: FakeRespond = options.respond ?? (() => coreLessonBody())

  return {
    calls,
    callsFor: (marker) => calls.filter((call) => call.marker === marker),
    maxInFlight: () => maxInFlight,
    async generateStructured(request: LlmRequest): Promise<LlmResponse> {
      const call: FakeLlmCall = {
        index: calls.length,
        marker: lessonMarker(request),
        request,
        startedAt: Date.now(),
      }
      calls.push(call)
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      try {
        if (options.delayMs) {
          await new Promise((resolve) => setTimeout(resolve, options.delayMs))
        }
        const output = await respond(request, call)
        return { output, usage: options.usage ?? TEST_USAGE, model: request.model }
      } finally {
        inFlight -= 1
      }
    },
  }
}

export interface Gate {
  promise: Promise<void>
  release(): void
}

/** A promise the test resolves by hand, to hold a fake call in flight. */
export function createGate(): Gate {
  let release = () => {}
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}
