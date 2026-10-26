// R17 editing commands: add and remove blocks (prompts), list items and parts, keeping the lesson
// shape valid. Each returns false and changes nothing when its target id is unknown or the change
// would break a schema minimum. New nodes come from `state.schema`, since the browser editor builds
// its own Schema instance. Contract: src/editor/README.md.
import type { Node as PmNode, Schema } from '@tiptap/pm/model'
import { TextSelection, type Command, type Transaction } from '@tiptap/pm/state'
import type { Block } from '../lesson/schema'
import { blockToNode, parseData, partToNode, valueNode } from './convert'
import {
  blockTypeOf,
  FIELD_LIST_NODE,
  FIELD_TEXT_NODE,
  lessonSchema,
  PART_NODE,
  SECTION_NODE,
} from './schema'
import type { StandardRef } from './standards'
import { arrayElement, blockShape, emptyObject, emptyValue } from './zod_shape'

/** Transactions from these commands may change the lesson structure (see structure_guard.ts). */
export const STRUCTURE_META = 'lessonStructure'

export interface Located {
  pos: number
  node: PmNode
}

/** The node with this `id` attribute, or null. */
export function findById(doc: PmNode, id: string): Located | null {
  let found: Located | null = null
  doc.descendants((node, pos) => {
    if (found) return false
    if (node.attrs.id === id) {
      found = { pos, node }
      return false
    }
    return true
  })
  return found
}

/** Direct children with their absolute positions. */
export function childrenAt({ pos, node }: Located): Located[] {
  const children: Located[] = []
  node.forEach((child, offset) => children.push({ pos: pos + 1 + offset, node: child }))
  return children
}

function parentOf(doc: PmNode, pos: number): PmNode {
  return doc.resolve(pos).parent
}

function structural(tr: Transaction): Transaction {
  return tr.setMeta(STRUCTURE_META, true)
}

/** Puts the caret in the first text field inside [from, to) (with this key, when given). */
function caretInto(tr: Transaction, from: number, to: number, key?: string): Transaction {
  let target: number | null = null
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (target !== null) return false
    if (node.isTextblock && (key === undefined || node.attrs.key === key)) {
      target = pos + 1
      return false
    }
    return true
  })
  return target === null ? tr : tr.setSelection(TextSelection.create(tr.doc, target))
}

function isBlock(node: PmNode): boolean {
  return blockTypeOf(node.type.name) !== null
}

/** An empty block of `type`; its text fields are empty, so it validates once filled in. */
export function emptyBlock(
  type: Block['type'],
  partStandards: string[] = [],
  schema: Schema = lessonSchema,
): PmNode {
  const shape = Object.fromEntries(
    Object.entries(blockShape(type)).filter(([key]) => key !== 'type' && key !== 'id'),
  )
  const value: Record<string, unknown> = { type, ...emptyObject(shape) }
  if (Array.isArray(value.options)) {
    value.options = value.options.map((option, index) => ({
      ...(option as Record<string, unknown>),
      correct: index === 0,
    }))
  }
  if (Array.isArray(value.standards) && 'standards' in shape) {
    value.standards = [...partStandards]
  }
  return schema.nodeFromJSON(blockToNode(value as unknown as Block))
}

export function addBlock(afterBlockId: string, type: Block['type']): Command {
  return (state, dispatch) => {
    const target = findById(state.doc, afterBlockId)
    if (!target || !isBlock(target.node)) return false
    const part = parentOf(state.doc, target.pos)
    const standards = (parseData(part.toJSON()).standards as string[] | undefined) ?? []
    if (dispatch) {
      const at = target.pos + target.node.nodeSize
      const block = emptyBlock(type, standards, state.schema)
      const tr = state.tr.insert(at, block)
      dispatch(structural(caretInto(tr, at, at + block.nodeSize)))
    }
    return true
  }
}

export function removeBlock(blockId: string): Command {
  return (state, dispatch) => {
    const target = findById(state.doc, blockId)
    if (!target || !isBlock(target.node)) return false
    const part = parentOf(state.doc, target.pos)
    let blocks = 0
    part.forEach((child) => {
      if (isBlock(child)) blocks += 1
    })
    if (blocks <= 1) return false
    if (dispatch) {
      dispatch(structural(state.tr.delete(target.pos, target.pos + target.node.nodeSize)))
    }
    return true
  }
}

/** The list field of a block (`items` when it has one), with its key. */
function listOf(block: Located): Located | null {
  const lists = childrenAt(block).filter(({ node }) => node.type.name === FIELD_LIST_NODE)
  return lists.find(({ node }) => node.attrs.key === 'items') ?? lists[0] ?? null
}

export function addListItem(listBlockId: string): Command {
  return (state, dispatch) => {
    const block = findById(state.doc, listBlockId)
    const type = block ? blockTypeOf(block.node.type.name) : null
    const list = block ? listOf(block) : null
    if (!block || !type || !list) return false
    const schema = blockShape(type)[String(list.node.attrs.key)]
    if (!schema) return false
    const element = arrayElement(schema)
    const item = valueNode(null, emptyValue(element), element)
    if (!item) return false
    if (dispatch) {
      const at = list.pos + list.node.nodeSize - 1
      dispatch(structural(state.tr.insert(at, state.schema.nodeFromJSON(item))))
    }
    return true
  }
}

export function removeListItem(listBlockId: string, index: number): Command {
  return (state, dispatch) => {
    const block = findById(state.doc, listBlockId)
    const list = block ? listOf(block) : null
    if (!list || list.node.childCount <= 1) return false
    const item = childrenAt(list)[index]
    if (!item) return false
    if (dispatch) {
      dispatch(structural(state.tr.delete(item.pos, item.pos + item.node.nodeSize)))
    }
    return true
  }
}

export function addPart(sectionId: string): Command {
  return (state, dispatch) => {
    const section = findById(state.doc, sectionId)
    if (!section || section.node.type.name !== SECTION_NODE) return false
    if (dispatch) {
      const inAction = parseData(section.node.toJSON()).kind === 'learning_in_action'
      // Learning in Action parts are named (label and title) so the reviewer can type the name.
      const named = inAction ? { label: nextPartLabel(section.node), title: '' } : {}
      const part = state.schema.nodeFromJSON(
        partToNode({ ...named, standards: [], blocks: [{ type: 'paragraph', text: '' }] }),
      )
      const at = section.pos + section.node.nodeSize - 1
      const tr = state.tr.insert(at, part)
      dispatch(structural(caretInto(tr, at, at + part.nodeSize, inAction ? 'title' : undefined)))
    }
    return true
  }
}

export function removePart(partId: string): Command {
  return (state, dispatch) => {
    const part = findById(state.doc, partId)
    if (!part || part.node.type.name !== PART_NODE) return false
    const section = parentOf(state.doc, part.pos)
    let parts = 0
    section.forEach((child) => {
      if (child.type.name === PART_NODE) parts += 1
    })
    if (parts <= 1) return false
    if (dispatch) {
      dispatch(structural(state.tr.delete(part.pos, part.pos + part.node.nodeSize)))
    }
    return true
  }
}

/** The label after the section's last one: "B" after "A", "Part C" after "Part B". */
function nextPartLabel(section: PmNode): string {
  const labels: string[] = []
  section.forEach((child) => {
    if (child.type.name !== PART_NODE) return
    child.forEach((field) => {
      if (field.attrs.key === 'label') labels.push(field.textContent)
    })
  })
  const last = labels[labels.length - 1] ?? ''
  const match = /^(Part )?([A-Y])$/i.exec(last.trim())
  if (match) {
    return `${match[1] ?? ''}${String.fromCharCode(match[2]!.toUpperCase().charCodeAt(0) + 1)}`
  }
  return String.fromCharCode('A'.charCodeAt(0) + labels.length)
}

/** Replaces a part's non-text data (minutes, standards). */
function updatePartData(
  partId: string,
  update: (data: Record<string, unknown>) => Record<string, unknown> | null,
): Command {
  return (state, dispatch) => {
    const part = findById(state.doc, partId)
    if (!part || part.node.type.name !== PART_NODE) return false
    const next = update(parseData(part.node.toJSON()))
    if (!next) return false
    if (dispatch) {
      const attrs = { ...part.node.attrs, data: JSON.stringify(next) }
      dispatch(structural(state.tr.setNodeMarkup(part.pos, undefined, attrs)))
    }
    return true
  }
}

/** Sets a part's minutes (a positive whole number), or removes them with null. */
export function setPartMinutes(partId: string, minutes: number | null): Command {
  return updatePartData(partId, (data) => {
    if (minutes === null) {
      const { minutes: _removed, ...rest } = data
      return _removed === undefined ? null : rest
    }
    if (!Number.isInteger(minutes) || minutes <= 0) return null
    return { ...data, minutes }
  })
}

/** Tags a part with a standard from the reference data (not already on it). */
export function addPartStandard(partId: string, code: string, reference: StandardRef[]): Command {
  return updatePartData(partId, (data) => {
    const codes = (data.standards as string[] | undefined) ?? []
    if (!reference.some((standard) => standard.code === code) || codes.includes(code)) return null
    return { ...data, standards: [...codes, code] }
  })
}

export function removePartStandard(partId: string, code: string): Command {
  return updatePartData(partId, (data) => {
    const codes = (data.standards as string[] | undefined) ?? []
    if (!codes.includes(code)) return null
    return { ...data, standards: codes.filter((standard) => standard !== code) }
  })
}

/**
 * Removes the list item holding `pos` (Backspace in an empty item, or its remove control) and puts
 * the caret at the end of the item before it (or the start of the next). False for the only item.
 */
export function removeListItemAt(pos: number): Command {
  return (state, dispatch) => {
    const $pos = state.doc.resolve(pos)
    const item = $pos.parent
    const list = $pos.node($pos.depth - 1)
    if (item.type.name !== FIELD_TEXT_NODE || list?.type.name !== FIELD_LIST_NODE) return false
    if (list.childCount <= 1) return false
    if (dispatch) {
      const index = $pos.index($pos.depth - 1)
      const start = $pos.before()
      const tr = state.tr.delete(start, start + item.nodeSize)
      const caret = index > 0 ? start - 1 : start + 1
      tr.setSelection(TextSelection.create(tr.doc, caret))
      dispatch(structural(tr))
    }
    return true
  }
}
