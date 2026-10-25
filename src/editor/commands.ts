// R17 editing commands: add and remove blocks (prompts), list items and parts, keeping the lesson
// shape valid. Each returns false and changes nothing when its target id is unknown or the change
// would break a schema minimum. New nodes come from `state.schema`, since the browser editor builds
// its own Schema instance. Contract: src/editor/README.md.
import type { Node as PmNode, Schema } from '@tiptap/pm/model'
import type { Command, Transaction } from '@tiptap/pm/state'
import type { Block } from '../lesson/schema'
import { blockToNode, parseData, partToNode, valueNode } from './convert'
import { blockTypeOf, FIELD_LIST_NODE, lessonSchema, PART_NODE } from './schema'
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
      dispatch(structural(state.tr.insert(at, emptyBlock(type, standards, state.schema))))
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
    if (!section || section.node.type.name !== 'lesson_section') return false
    if (dispatch) {
      const part = partToNode({ standards: [], blocks: [{ type: 'paragraph', text: '' }] })
      const at = section.pos + section.node.nodeSize - 1
      dispatch(structural(state.tr.insert(at, state.schema.nodeFromJSON(part))))
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
