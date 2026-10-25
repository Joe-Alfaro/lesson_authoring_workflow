// R7 / R12: provider-agnostic LLM client, cost from a per-model price table.
// Contract: src/generation/README.md. No test calls a real model.
import { describe, expect, it } from 'vitest'
import { createFakeLlm, TEST_MODEL, TEST_PRICES } from '../../tests/fake_llm'
import {
  computeCostUsd,
  DEFAULT_MODEL,
  ESTIMATED_TOKENS_PER_LESSON,
  estimateCostUsd,
  MODEL_PRICES,
  UnknownModelError,
  type LlmClient,
} from './llm'

describe('computeCostUsd', () => {
  it('prices input and output tokens per million from the table', () => {
    const prices = { 'some-model': { inputPerMTok: 1, outputPerMTok: 5 } }
    const cost = computeCostUsd('some-model', { inputTokens: 1000, outputTokens: 2000 }, prices)
    expect(cost).toBeCloseTo(0.011, 10)
  })

  it('is zero for zero tokens', () => {
    expect(computeCostUsd(TEST_MODEL, { inputTokens: 0, outputTokens: 0 }, TEST_PRICES)).toBe(0)
  })

  it('throws UnknownModelError for a model missing from the table', () => {
    expect(() =>
      computeCostUsd('no-such-model', { inputTokens: 1, outputTokens: 1 }, TEST_PRICES),
    ).toThrow(UnknownModelError)
  })

  it('uses MODEL_PRICES by default', () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000 }
    const price = MODEL_PRICES[DEFAULT_MODEL]!
    expect(computeCostUsd(DEFAULT_MODEL, usage)).toBeCloseTo(
      price.inputPerMTok + price.outputPerMTok,
      10,
    )
  })
})

describe('price table and defaults (R12)', () => {
  it('defaults to a priced, low-cost (Haiku-class) model', () => {
    expect(DEFAULT_MODEL).toMatch(/haiku/i)
    const price = MODEL_PRICES[DEFAULT_MODEL]
    expect(price?.inputPerMTok).toBeGreaterThan(0)
    expect(price?.outputPerMTok).toBeGreaterThan(0)
  })

  it('estimates a run as lessons x per-lesson token estimate x price', () => {
    expect(ESTIMATED_TOKENS_PER_LESSON.inputTokens).toBeGreaterThan(0)
    expect(ESTIMATED_TOKENS_PER_LESSON.outputTokens).toBeGreaterThan(0)
    const perLesson = computeCostUsd(TEST_MODEL, ESTIMATED_TOKENS_PER_LESSON, TEST_PRICES)
    expect(estimateCostUsd(TEST_MODEL, 41, TEST_PRICES)).toBeCloseTo(41 * perLesson, 10)
  })
})

describe('LlmClient interface', () => {
  it('returns structured output and token usage', async () => {
    const client: LlmClient = createFakeLlm({ respond: () => ({ answer: 42 }) })
    const response = await client.generateStructured({
      model: TEST_MODEL,
      system: 'system text',
      prompt: 'prompt text',
      schema: { type: 'object' },
    })
    expect(response).toEqual({
      output: { answer: 42 },
      usage: { inputTokens: 1000, outputTokens: 1000 },
      model: TEST_MODEL,
    })
  })
})
