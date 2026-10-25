// R6 / R12: generation settings from the environment. Contract: src/generation/README.md.
import { describe, expect, it } from 'vitest'
import { DEFAULT_MODEL } from './llm'
import { getGenerationSettings } from './settings'

describe('getGenerationSettings', () => {
  it('has defaults: Haiku-class model, concurrency 4, 2 attempts, $5 cap', () => {
    expect(getGenerationSettings({})).toEqual({
      model: DEFAULT_MODEL,
      concurrency: 4,
      maxAttempts: 2,
      capUsd: 5,
    })
  })

  it('reads overrides from the environment', () => {
    expect(
      getGenerationSettings({
        GENERATION_MODEL: 'other-model',
        GENERATION_CONCURRENCY: '8',
        GENERATION_MAX_ATTEMPTS: '3',
        GENERATION_SPEND_CAP_USD: '1.5',
      }),
    ).toEqual({ model: 'other-model', concurrency: 8, maxAttempts: 3, capUsd: 1.5 })
  })

  it.each([
    ['GENERATION_CONCURRENCY', '0'],
    ['GENERATION_CONCURRENCY', 'many'],
    ['GENERATION_MAX_ATTEMPTS', '0'],
    ['GENERATION_SPEND_CAP_USD', '-1'],
    ['GENERATION_SPEND_CAP_USD', 'free'],
  ])('rejects %s=%s', (name, value) => {
    expect(() => getGenerationSettings({ [name]: value })).toThrow(name)
  })
})
