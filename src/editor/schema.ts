// The Tiptap/ProseMirror lesson schema, derived from the Zod lesson schema (D-016, R17). Isomorphic:
// the browser editor, the Node unit tests and the collab server all build it from these extensions.
// Contract: src/editor/README.md.
//
// Shape of the document:
//   doc > lesson_body (body data) > field nodes, front_matter, lesson_section+
//   front_matter (outline-owned data) > standard_group (focus, supporting, ELD) > standard_chip
//   lesson_section > field nodes, lesson_part+ ; lesson_part > field nodes, one node per block type
//   field_text: one free text string (textblock, bold/italic marks), keyed by its field name
//   field_list: an array; field_group: an object (its non-text values in `data`)
// Values that aren't free text (enums, numbers, booleans, standard codes, null) live in a node's
// `data` attribute as JSON, so every lesson field survives the round trip.
import { getSchema, Node, type AnyExtension, type Extensions, type NodeConfig } from '@tiptap/core'
import Bold from '@tiptap/extension-bold'
import Italic from '@tiptap/extension-italic'
import Text from '@tiptap/extension-text'
import type { Schema } from '@tiptap/pm/model'
import { BLOCK_TYPES, type Block } from '../lesson/schema'

export const BODY_NODE = 'lesson_body'
export const FRONT_MATTER_NODE = 'front_matter'
export const STANDARD_GROUP_NODE = 'standard_group'
export const STANDARD_CHIP_NODE = 'standard_chip'
export const SECTION_NODE = 'lesson_section'
export const PART_NODE = 'lesson_part'
export const FIELD_TEXT_NODE = 'field_text'
export const FIELD_LIST_NODE = 'field_list'
export const FIELD_GROUP_NODE = 'field_group'

/** Group of every lesson block node (one per Zod block type). */
export const BLOCK_GROUP = 'lessonBlock'
/** Group of the generic field nodes. */
export const FIELD_GROUP = 'lessonField'

const BLOCK_PREFIX = 'block_'

export function blockNodeName(type: Block['type']): string {
  return `${BLOCK_PREFIX}${type}`
}

/** The block type of a block node name, or null for any other node. */
export function blockTypeOf(nodeName: string): Block['type'] | null {
  if (!nodeName.startsWith(BLOCK_PREFIX)) return null
  const type = nodeName.slice(BLOCK_PREFIX.length)
  return (BLOCK_TYPES as readonly string[]).includes(type) ? (type as Block['type']) : null
}

/** Keeps an attribute in the document (and in Yjs) without writing it into the rendered HTML. */
function stored(defaultValue: string | null) {
  return { default: defaultValue, rendered: false, keepOnSplit: false }
}

/** Optional node views (browser only); the schema is the same with or without them. */
export type LessonNodeViews = Partial<Record<string, NodeConfig['addNodeView']>>

function lessonNode(config: NodeConfig, views: LessonNodeViews): AnyExtension {
  const view = views[config.name]
  return Node.create(view ? { ...config, addNodeView: view } : config)
}

function domFor(name: string) {
  return {
    parseHTML: () => [{ tag: `div[data-node="${name}"]` }],
    renderHTML: () => ['div', { 'data-node': name }, 0] as const,
  }
}

export function lessonEditorExtensions(views: LessonNodeViews = {}): Extensions {
  const fields = `${FIELD_GROUP}*`
  const nodes: NodeConfig[] = [
    { name: 'doc', topNode: true, content: BODY_NODE },
    {
      name: BODY_NODE,
      content: `${fields} ${FRONT_MATTER_NODE} ${fields} ${SECTION_NODE}+ ${fields}`,
      isolating: true,
      addAttributes: () => ({ data: stored('{}') }),
      ...domFor(BODY_NODE),
    },
    {
      name: FRONT_MATTER_NODE,
      content: `${STANDARD_GROUP_NODE}*`,
      isolating: true,
      addAttributes: () => ({ data: stored('{}') }),
      ...domFor(FRONT_MATTER_NODE),
    },
    {
      name: STANDARD_GROUP_NODE,
      content: `${STANDARD_CHIP_NODE}*`,
      isolating: true,
      addAttributes: () => ({ key: stored(null) }),
      ...domFor(STANDARD_GROUP_NODE),
    },
    {
      name: STANDARD_CHIP_NODE,
      atom: true,
      selectable: false,
      draggable: false,
      addAttributes: () => ({ code: stored(''), levels: stored(null) }),
      parseHTML: () => [{ tag: `span[data-node="${STANDARD_CHIP_NODE}"]` }],
      renderHTML: ({ node }) => [
        'span',
        { 'data-node': STANDARD_CHIP_NODE, class: 'chip' },
        String(node.attrs.code),
      ],
    },
    {
      name: SECTION_NODE,
      content: `${fields} ${PART_NODE}+`,
      isolating: true,
      addAttributes: () => ({ id: stored(null), data: stored('{}') }),
      ...domFor(SECTION_NODE),
    },
    {
      name: PART_NODE,
      content: `${fields} ${BLOCK_GROUP}+`,
      isolating: true,
      addAttributes: () => ({ id: stored(null), data: stored('{}') }),
      ...domFor(PART_NODE),
    },
    ...BLOCK_TYPES.map((type): NodeConfig => ({
      name: blockNodeName(type),
      group: BLOCK_GROUP,
      content: fields,
      isolating: true,
      addAttributes: () => ({ id: stored(null), data: stored('{}') }),
      ...domFor(blockNodeName(type)),
    })),
    {
      name: FIELD_TEXT_NODE,
      group: FIELD_GROUP,
      content: 'text*',
      marks: 'bold italic',
      isolating: true,
      addAttributes: () => ({ key: stored(null) }),
      parseHTML: () => [{ tag: `p[data-node="${FIELD_TEXT_NODE}"]` }],
      renderHTML: () => ['p', { 'data-node': FIELD_TEXT_NODE }, 0],
    },
    {
      name: FIELD_LIST_NODE,
      group: FIELD_GROUP,
      content: fields,
      isolating: true,
      addAttributes: () => ({ key: stored(null) }),
      ...domFor(FIELD_LIST_NODE),
    },
    {
      name: FIELD_GROUP_NODE,
      group: FIELD_GROUP,
      content: fields,
      isolating: true,
      addAttributes: () => ({ key: stored(null), data: stored('{}') }),
      ...domFor(FIELD_GROUP_NODE),
    },
  ]
  return [...nodes.map((node) => lessonNode(node, views)), Text, Bold, Italic]
}

export const lessonSchema: Schema = getSchema(lessonEditorExtensions())
