// Validation fix (M3): generated content already says "Part A" and "Unit 4: <title>", so the
// labels must not repeat "Part" or "Unit N:".
import { describe, expect, it } from 'vitest'
import { partName, unitKicker } from './labels'

describe('partName', () => {
  it('adds "Part" to a bare letter or number only', () => {
    expect(partName('A', 'Reading the opening')).toBe('Part A: Reading the opening')
    expect(partName('Part A', 'Reading the opening')).toBe('Part A: Reading the opening')
    expect(partName('Huddle 1', undefined)).toBe('Huddle 1')
    expect(partName('B', undefined)).toBe('Part B')
    expect(partName(undefined, 'Writing')).toBe('Writing')
    expect(partName(undefined, undefined)).toBe('')
  })
})

describe('unitKicker', () => {
  it('adds "Unit N:" only when the title doesn’t start with it', () => {
    expect(unitKicker(4, 'The Lightning Thief')).toBe('Unit 4: The Lightning Thief')
    expect(unitKicker(4, 'Unit 4: The Lightning Thief')).toBe('Unit 4: The Lightning Thief')
  })
})
