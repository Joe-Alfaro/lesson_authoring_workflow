import { describe, expect, it } from 'vitest'
import { formatUsd, modelLabel } from './format'

describe('formatUsd', () => {
  it('shows dollars with two decimals', () => {
    expect(formatUsd(0.5084)).toBe('$0.51')
    expect(formatUsd(5)).toBe('$5.00')
    expect(formatUsd(12)).toBe('$12.00')
    expect(formatUsd(0)).toBe('$0.00')
  })
})

describe('modelLabel', () => {
  it('names the model class shown in the start dialog and the cost panel', () => {
    expect(modelLabel('claude-haiku-5-5')).toBe('Haiku-class')
    expect(modelLabel('claude-sonnet-5-5')).toBe('Sonnet-class')
    expect(modelLabel('claude-opus-5-5')).toBe('Opus-class')
  })

  it('returns an unknown model id unchanged', () => {
    expect(modelLabel('test-model')).toBe('test-model')
  })
})
