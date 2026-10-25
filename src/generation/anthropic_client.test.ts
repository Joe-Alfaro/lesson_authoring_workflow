// The adapter's schema conversion for structured outputs (no network calls).
import { describe, expect, it } from 'vitest'
import { lessonBodyJsonSchema } from '../lesson/schema'
import { toStructuredOutputSchema } from './anthropic_client'

function walk(node: unknown, visit: (value: Record<string, unknown>) => void): void {
  if (Array.isArray(node)) {
    node.forEach((item) => walk(item, visit))
    return
  }
  if (node && typeof node === 'object') {
    visit(node as Record<string, unknown>)
    Object.values(node).forEach((value) => walk(value, visit))
  }
}

describe('toStructuredOutputSchema', () => {
  const schema = toStructuredOutputSchema(lessonBodyJsonSchema())

  it('drops constraints structured outputs reject', () => {
    walk(schema, (node) => {
      ;['$schema', 'minLength', 'maximum', 'exclusiveMinimum', 'maxItems', 'oneOf'].forEach((key) =>
        expect(node).not.toHaveProperty(key),
      )
      if ('minItems' in node) {
        expect(node.minItems).toBeLessThanOrEqual(1)
      }
    })
  })

  it('closes every object', () => {
    walk(schema, (node) => {
      if (node.type === 'object' && node.properties) {
        expect(node.additionalProperties).toBe(false)
      }
    })
  })

  it('keeps the block discriminators and required fields', () => {
    const text = JSON.stringify(schema)
    expect(text).toContain('"pulse_check"')
    expect(schema).toEqual(
      expect.objectContaining({ required: expect.arrayContaining(['title', 'sections']) }),
    )
  })
})
