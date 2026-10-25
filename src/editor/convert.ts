// Lesson JSON <-> ProseMirror JSON (D-016, R17). `docToLesson(lessonToDoc(x))` equals `x` for any
// valid lesson with ids. Contract: src/editor/README.md.
import type { JSONContent } from '@tiptap/core'
import type { z } from 'zod'
import {
  LessonBody,
  LessonContent,
  Part,
  Section,
  type Block,
  type LessonValidationError,
} from '../lesson/schema'
import { parseInline, serializeInline } from './inline'
import {
  blockNodeName,
  blockTypeOf,
  BODY_NODE,
  FIELD_GROUP_NODE,
  FIELD_LIST_NODE,
  FIELD_TEXT_NODE,
  FRONT_MATTER_NODE,
  PART_NODE,
  SECTION_NODE,
  STANDARD_CHIP_NODE,
  STANDARD_GROUP_NODE,
} from './schema'
import {
  arrayElement,
  blockShape,
  CODE_KEYS,
  isFreeString,
  objectShape,
  schemaType,
} from './zod_shape'

export type SnapshotResult =
  { ok: true; lesson: LessonContent } | { ok: false; errors: LessonValidationError[] }

type Schema = z.ZodType
type Json = Record<string, unknown>

/** Front-matter standards shown as chips, in display order. */
export const STANDARD_GROUP_KEYS = [
  'focusStandards',
  'supportingStandards',
  'eldStandards',
] as const

/**
 * Body fields in the order the editor shows them (docs/design R17-lesson-editor: the title, the
 * front matter with vocabulary and materials, objectives, questions, connections, then sections).
 */
const BODY_ORDER = [
  'title',
  'vocabulary',
  'materials',
  'objectives',
  'essentialQuestions',
  'connections',
  'homework',
]
const BEFORE_FRONT_MATTER = new Set(['title'])

export function newId(): string {
  return globalThis.crypto.randomUUID()
}

function textNode(key: string | null, value: string): JSONContent {
  const content = parseInline(value)
  return {
    type: FIELD_TEXT_NODE,
    attrs: { key },
    ...(content.length > 0 ? { content } : {}),
  }
}

export function valueNode(key: string | null, value: unknown, schema: Schema): JSONContent | null {
  if (typeof value === 'string' && isFreeString(schema)) {
    return textNode(key, value)
  }
  if (Array.isArray(value)) {
    const element = arrayElement(schema)
    return {
      type: FIELD_LIST_NODE,
      attrs: { key },
      content: value.map((item) => valueNode(null, item, element)).filter(isNode),
    }
  }
  if (value !== null && typeof value === 'object' && schemaType(schema) === 'object') {
    const { data, children } = encodeFields(objectShape(schema), value as Json)
    return { type: FIELD_GROUP_NODE, attrs: { key, data: JSON.stringify(data) }, content: children }
  }
  return null
}

function isNode(node: JSONContent | null): node is JSONContent {
  return node !== null
}

/** Free text, arrays and objects become child nodes; every other value stays in `data`. */
function encodeFields(
  shape: Record<string, Schema>,
  value: Json,
  skip: readonly string[] = [],
): { data: Json; children: JSONContent[] } {
  const data: Json = {}
  const children: JSONContent[] = []
  Object.keys(shape)
    .filter((key) => !skip.includes(key) && key in value)
    .forEach((key) => {
      const node = CODE_KEYS.has(key) ? null : valueNode(key, value[key], shape[key]!)
      if (node) {
        children.push(node)
      } else {
        data[key] = value[key]
      }
    })
  return { data, children }
}

export function blockToNode(block: Block): JSONContent {
  const { data, children } = encodeFields(blockShape(block.type), block as unknown as Json, [
    'type',
    'id',
  ])
  return {
    type: blockNodeName(block.type),
    attrs: { id: block.id ?? newId(), data: JSON.stringify(data) },
    content: children,
  }
}

export function partToNode(part: Part): JSONContent {
  const { data, children } = encodeFields(Part.shape, part as unknown as Json, ['id', 'blocks'])
  return {
    type: PART_NODE,
    attrs: { id: part.id ?? newId(), data: JSON.stringify(data) },
    content: [...children, ...part.blocks.map(blockToNode)],
  }
}

function sectionToNode(section: Section): JSONContent {
  const { data, children } = encodeFields(Section.shape, section as unknown as Json, [
    'id',
    'parts',
  ])
  return {
    type: SECTION_NODE,
    attrs: { id: section.id ?? newId(), data: JSON.stringify(data) },
    content: [...children, ...section.parts.map(partToNode)],
  }
}

function frontMatterNode(frontMatter: LessonContent['frontMatter']): JSONContent {
  const data = Object.fromEntries(
    Object.entries(frontMatter).filter(
      ([key]) => !(STANDARD_GROUP_KEYS as readonly string[]).includes(key),
    ),
  )
  const chips = (key: (typeof STANDARD_GROUP_KEYS)[number]): JSONContent[] =>
    key === 'eldStandards'
      ? frontMatter.eldStandards.map((eld) => ({
          type: STANDARD_CHIP_NODE,
          attrs: { code: eld.code, levels: JSON.stringify(eld.levels) },
        }))
      : frontMatter[key].map((code) => ({
          type: STANDARD_CHIP_NODE,
          attrs: { code, levels: null },
        }))
  return {
    type: FRONT_MATTER_NODE,
    attrs: { data: JSON.stringify(data) },
    content: STANDARD_GROUP_KEYS.map((key) => ({
      type: STANDARD_GROUP_NODE,
      attrs: { key },
      content: chips(key),
    })),
  }
}

export function lessonToDoc(content: LessonContent): JSONContent {
  const bodyShape = LessonBody.shape as unknown as Record<string, Schema>
  const { data, children } = encodeFields(bodyShape, content.body as unknown as Json, ['sections'])
  const ordered = [...children].sort(
    (a, b) => BODY_ORDER.indexOf(String(a.attrs?.key)) - BODY_ORDER.indexOf(String(b.attrs?.key)),
  )
  const before = ordered.filter((node) => BEFORE_FRONT_MATTER.has(String(node.attrs?.key)))
  const fields = ordered.filter((node) => !BEFORE_FRONT_MATTER.has(String(node.attrs?.key)))
  const homework = fields.filter((node) => node.attrs?.key === 'homework')
  const afterFrontMatter = fields.filter((node) => node.attrs?.key !== 'homework')
  return {
    type: 'doc',
    content: [
      {
        type: BODY_NODE,
        attrs: { data: JSON.stringify({ ...data, schemaVersion: content.schemaVersion }) },
        content: [
          ...before,
          frontMatterNode(content.frontMatter),
          ...afterFrontMatter,
          ...content.body.sections.map(sectionToNode),
          ...homework,
        ],
      },
    ],
  }
}

// ---------- doc -> lesson ----------

function parseJson(raw: unknown): unknown {
  if (typeof raw !== 'string') return undefined
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
}

export function parseData(node: JSONContent): Json {
  const parsed = parseJson(node.attrs?.data)
  return parsed !== null && typeof parsed === 'object' ? (parsed as Json) : {}
}

function childrenOf(node: JSONContent): JSONContent[] {
  return node.content ?? []
}

function decodeValue(node: JSONContent): unknown {
  if (node.type === FIELD_TEXT_NODE) return serializeInline(node.content)
  if (node.type === FIELD_LIST_NODE) return childrenOf(node).map(decodeValue)
  if (node.type === FIELD_GROUP_NODE) return decodeFields(node)
  return undefined
}

/** `data` plus one entry per keyed field child. */
function decodeFields(node: JSONContent): Json {
  const value: Json = { ...parseData(node) }
  childrenOf(node)
    .filter((child) => typeof child.attrs?.key === 'string')
    .forEach((child) => {
      const decoded = decodeValue(child)
      if (decoded !== undefined) value[child.attrs!.key as string] = decoded
    })
  return value
}

function withId(node: JSONContent, value: Json): Json {
  const id = node.attrs?.id
  return typeof id === 'string' && id ? { id, ...value } : value
}

function decodeBlock(node: JSONContent): Json {
  return withId(node, { type: blockTypeOf(node.type ?? ''), ...decodeFields(node) })
}

function decodePart(node: JSONContent): Json {
  return withId(node, {
    ...decodeFields(node),
    blocks: childrenOf(node)
      .filter((child) => blockTypeOf(child.type ?? '') !== null)
      .map(decodeBlock),
  })
}

function decodeSection(node: JSONContent): Json {
  return withId(node, {
    ...decodeFields(node),
    parts: childrenOf(node)
      .filter((child) => child.type === PART_NODE)
      .map(decodePart),
  })
}

function decodeFrontMatter(node: JSONContent | undefined): Json {
  if (!node) return {}
  const frontMatter: Json = { ...parseData(node) }
  childrenOf(node)
    .filter((child) => child.type === STANDARD_GROUP_NODE)
    .forEach((group) => {
      const key = String(group.attrs?.key)
      const chips = childrenOf(group).filter((chip) => chip.type === STANDARD_CHIP_NODE)
      frontMatter[key] =
        key === 'eldStandards'
          ? chips.map((chip) => ({
              code: chip.attrs?.code,
              levels: parseJson(chip.attrs?.levels),
            }))
          : chips.map((chip) => chip.attrs?.code)
    })
  return frontMatter
}

function decodeLesson(doc: JSONContent): Json {
  const body = childrenOf(doc).find((node) => node.type === BODY_NODE)
  if (!body) return {}
  const { schemaVersion, ...fields } = decodeFields(body)
  return {
    schemaVersion,
    frontMatter: decodeFrontMatter(
      childrenOf(body).find((node) => node.type === FRONT_MATTER_NODE),
    ),
    body: {
      ...fields,
      sections: childrenOf(body)
        .filter((node) => node.type === SECTION_NODE)
        .map(decodeSection),
    },
  }
}

/** Validates with the Zod schema only (no R7 cross-field checks, so mid-edit isn't blocked). */
export function docToLesson(doc: JSONContent): SnapshotResult {
  const parsed = LessonContent.safeParse(decodeLesson(doc))
  if (parsed.success) {
    return { ok: true, lesson: parsed.data }
  }
  return {
    ok: false,
    errors: parsed.error.issues.map((issue) => {
      const path = issue.path.map(String).join('.') || '(root)'
      return { code: 'schema', path, message: `${path}: ${issue.message}` }
    }),
  }
}
