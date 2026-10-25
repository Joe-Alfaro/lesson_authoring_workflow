// Reading the JSON answer (no network calls).
import { describe, expect, it } from 'vitest'
import { extractJson } from './anthropic_client'

describe('extractJson', () => {
  it('reads a bare JSON object', () => {
    expect(extractJson('{"title":"A"}')).toEqual({ title: 'A' })
  })

  it('reads an object wrapped in a Markdown fence or surrounded by text', () => {
    expect(extractJson('Here it is:\n```json\n{"title":"A","n":[1]}\n```\n')).toEqual({
      title: 'A',
      n: [1],
    })
  })

  it('throws for malformed JSON or no object at all', () => {
    expect(() => extractJson('{"sections": [}')).toThrow(SyntaxError)
    expect(() => extractJson('no json here')).toThrow(SyntaxError)
  })
})
