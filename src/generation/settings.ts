// Generation settings from the environment (R6, R12). Contract: src/generation/README.md.
import { DEFAULT_MODEL } from './llm'

export interface GenerationSettings {
  model: string
  concurrency: number
  maxAttempts: number
  /** Default per-run spend cap in USD. */
  capUsd: number
}

type Env = Record<string, string | undefined>

function readNumber(
  env: Env,
  name: string,
  fallback: number,
  isValid: (value: number) => boolean,
  rule: string,
): number {
  const raw = env[name]?.trim()
  if (!raw) {
    return fallback
  }
  const value = Number(raw)
  if (!Number.isFinite(value) || !isValid(value)) {
    throw new Error(`${name} must be ${rule}, got "${raw}"`)
  }
  return value
}

function positiveInteger(env: Env, name: string, fallback: number): number {
  return readNumber(env, name, fallback, (v) => Number.isInteger(v) && v >= 1, 'an integer >= 1')
}

function nonNegative(env: Env, name: string, fallback: number): number {
  return readNumber(env, name, fallback, (v) => v >= 0, 'a number >= 0')
}

export function getGenerationSettings(env: Env = process.env): GenerationSettings {
  return {
    model: env.GENERATION_MODEL?.trim() || DEFAULT_MODEL,
    concurrency: positiveInteger(env, 'GENERATION_CONCURRENCY', 4),
    maxAttempts: positiveInteger(env, 'GENERATION_MAX_ATTEMPTS', 2),
    capUsd: nonNegative(env, 'GENERATION_SPEND_CAP_USD', 5),
  }
}

/** Global LLM budget across all runs (D-010, D-024): `SPEND_CAP_USD`, default $20. */
export function getGlobalSpendCapUsd(env: Env = process.env): number {
  return nonNegative(env, 'SPEND_CAP_USD', 20)
}

const EFFORTS = ['low', 'medium', 'high'] as const

/** Model thinking effort for generation: `GENERATION_EFFORT`, default medium. */
export function getGenerationEffort(env: Env = process.env): (typeof EFFORTS)[number] {
  const raw = env.GENERATION_EFFORT?.trim()
  if (!raw) {
    return 'medium'
  }
  const effort = EFFORTS.find((value) => value === raw)
  if (!effort) {
    throw new Error(`GENERATION_EFFORT must be one of ${EFFORTS.join(', ')}, got "${raw}"`)
  }
  return effort
}
