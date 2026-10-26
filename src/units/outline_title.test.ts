import { describe, expect, it } from 'vitest'
import { outlineTitle } from './outline_title'

describe('outlineTitle (R9 dashboard rows before generation)', () => {
  it('adds the first page range of the description to its first line', () => {
    expect(outlineTitle('Chapter 1\nFocus: pp. 1–8 Teacher Read Aloud')).toBe('Chapter 1, pp. 1–8')
    expect(outlineTitle('  Chapter 3  \nFocus: pp. 37-43\nLater pp. 50–60')).toBe(
      'Chapter 3, pp. 37-43',
    )
  })

  it('keeps the first line alone when there is no page range or it already has one', () => {
    expect(outlineTitle('What Are Myths?\nSpark the unit')).toBe('What Are Myths?')
    expect(outlineTitle('Chapter 2, pp. 16–22\nFocus: pp. 16–22')).toBe('Chapter 2, pp. 16–22')
  })
})
