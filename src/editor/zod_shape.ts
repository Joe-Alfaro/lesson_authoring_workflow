// Reads the lesson Zod schema (D-016) so the editor derives its encoding and empty blocks from it
// instead of a second, hand-written copy of the block shapes.
import type { z } from 'zod'
import { Block } from '../lesson/schema'

type Schema = z.ZodType

interface Def {
  type: string
  innerType?: Schema
  element?: Schema
  options?: readonly unknown[]
  checks?: { _zod: { def: { check: string; minimum?: number; length?: number } } }[]
}

function defOf(schema: Schema): Def {
  return (schema as unknown as { _zod: { def: Def } })._zod.def
}

const WRAPPERS = new Set(['optional', 'nullable', 'default', 'prefault', 'readonly', 'catch'])

/** The schema without optional/nullable/default wrappers. */
export function unwrap(schema: Schema): Schema {
  const def = defOf(schema)
  if (WRAPPERS.has(def.type) && def.innerType) {
    return unwrap(def.innerType)
  }
  return schema
}

export function schemaType(schema: Schema): string {
  return defOf(unwrap(schema)).type
}

export function isOptional(schema: Schema): boolean {
  return defOf(schema).type === 'optional'
}

/** A free text string (z.string()), as opposed to an enum or literal. */
export function isFreeString(schema: Schema): boolean {
  return schemaType(schema) === 'string'
}

export function arrayElement(schema: Schema): Schema {
  const element = defOf(unwrap(schema)).element
  if (!element) {
    throw new Error('Not an array schema')
  }
  return element
}

/** Minimum items of an array schema (`min(n)` or `length(n)`), 0 when unconstrained. */
export function minItems(schema: Schema): number {
  const checks = defOf(unwrap(schema)).checks ?? []
  return checks.reduce((min, check) => {
    const { check: kind, minimum, length } = check._zod.def
    if (kind === 'min_length' && minimum !== undefined) return Math.max(min, minimum)
    if (kind === 'length_equals' && length !== undefined) return Math.max(min, length)
    return min
  }, 0)
}

export function objectShape(schema: Schema): Record<string, Schema> {
  return (unwrap(schema) as unknown as { shape: Record<string, Schema> }).shape
}

export function blockShape(type: Block['type']): Record<string, Schema> {
  const option = Block.options.find((candidate) => candidate.shape.type.value === type)
  if (!option) {
    throw new Error(`Unknown block type ${type}`)
  }
  return option.shape as unknown as Record<string, Schema>
}

/**
 * Keys whose string values are standard codes: kept as data, never typed as free text (R17).
 */
export const CODE_KEYS = new Set(['standards', 'standard'])

/**
 * The smallest value of a schema a reviewer fills in: required strings empty, required arrays with
 * their minimum number of empty items, optional fields absent. Enums take their first option.
 */
export function emptyValue(schema: Schema, key?: string): unknown {
  const type = schemaType(schema)
  const def = defOf(unwrap(schema))
  if (type === 'string') return ''
  if (type === 'boolean') return false
  if (type === 'number') return 0
  if (type === 'enum') return (def.options as unknown[] | undefined)?.[0] ?? ''
  if (type === 'array') {
    if (key && CODE_KEYS.has(key)) return []
    const element = arrayElement(schema)
    return Array.from({ length: minItems(schema) }, () => emptyValue(element))
  }
  if (type === 'object') {
    return emptyObject(objectShape(schema))
  }
  if (type === 'nullable') return null
  return null
}

export function emptyObject(shape: Record<string, Schema>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(shape)
      .filter(([, schema]) => !isOptional(schema))
      .map(([key, schema]) => [key, emptyValue(schema, key)]),
  )
}
