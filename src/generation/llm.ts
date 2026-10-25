// Provider-agnostic LLM client and the per-model price table (R7, R12).
// Contract: src/generation/README.md.

export interface LlmRequest {
  model: string
  system: string
  prompt: string
  /** JSON schema the structured output must follow. */
  schema: Record<string, unknown>
  maxTokens?: number
}

export interface LlmUsage {
  inputTokens: number
  outputTokens: number
}

export interface LlmResponse {
  /** Raw structured JSON; validation happens in the worker, not the client. */
  output: unknown
  usage: LlmUsage
  model: string
}

export interface LlmClient {
  generateStructured(request: LlmRequest): Promise<LlmResponse>
}

/** USD per 1M tokens. */
export type PriceTable = Record<string, { inputPerMTok: number; outputPerMTok: number }>

// First-party API prices (prompts up to 100K tokens), checked 2026-10-25.
export const MODEL_PRICES: PriceTable = {
  'claude-haiku-5-5': { inputPerMTok: 0.1, outputPerMTok: 0.5 },
  'claude-sonnet-5-5': { inputPerMTok: 2, outputPerMTok: 10 },
  'claude-opus-5-5': { inputPerMTok: 4, outputPerMTok: 20 },
}

/** Haiku-class default for development (D-026); the full-unit run picks Sonnet explicitly. */
export const DEFAULT_MODEL = 'claude-haiku-5-5'

/** Expected tokens for one lesson including thinking, until a unit has measured lessons. */
export const ESTIMATED_TOKENS_PER_LESSON: LlmUsage = { inputTokens: 12_000, outputTokens: 12_000 }

export class UnknownModelError extends Error {
  constructor(readonly model: string) {
    super(`No price for model "${model}"; add it to the price table first`)
    this.name = 'UnknownModelError'
  }
}

export function priceFor(model: string, prices: PriceTable = MODEL_PRICES) {
  const price = prices[model]
  if (!price) {
    throw new UnknownModelError(model)
  }
  return price
}

export function computeCostUsd(
  model: string,
  usage: LlmUsage,
  prices: PriceTable = MODEL_PRICES,
): number {
  const price = priceFor(model, prices)
  return (
    (usage.inputTokens * price.inputPerMTok) / 1e6 +
    (usage.outputTokens * price.outputPerMTok) / 1e6
  )
}

export function estimateCostUsd(
  model: string,
  lessonCount: number,
  prices: PriceTable = MODEL_PRICES,
): number {
  return lessonCount * computeCostUsd(model, ESTIMATED_TOKENS_PER_LESSON, prices)
}
