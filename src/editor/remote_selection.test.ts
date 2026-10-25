// R18: the caret stays with its text when a collaborator edits the same field.
import { describe, expect, it } from 'vitest'
import { mapTextOffset } from './remote_selection'

describe('mapTextOffset', () => {
  it('moves the caret right when text is inserted before it', () => {
    expect(mapTextOffset('Today we meet. From', 'XToday we meet. From', 19)).toBe(20)
  })

  it('keeps the caret when text is inserted after it', () => {
    expect(mapTextOffset('Today we meet.', 'Today we meet. From B', 5)).toBe(5)
  })

  it('keeps the caret at the end when the other person types elsewhere', () => {
    expect(mapTextOffset('abc', 'Xabc', 3)).toBe(4)
    expect(mapTextOffset('abc', 'abc', 3)).toBe(3)
  })

  it('moves the caret left when text before it is deleted', () => {
    expect(mapTextOffset('Hello world', 'world', 8)).toBe(2)
  })
})
