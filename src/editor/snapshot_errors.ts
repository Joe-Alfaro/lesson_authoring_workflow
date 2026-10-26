// R17: when the lesson can't be saved (a required field is empty), say which field it is and where
// it is, so the reviewer can fill it in. Maps a Zod error path to the doc node it belongs to.
import type { Node as PmNode } from '@tiptap/pm/model'
import { SECTION_NAMES, partName, type SectionKind } from '../lesson/labels'
import type { LessonValidationError } from '../lesson/schema'
import { parseData } from './convert'
import {
  blockTypeOf,
  BODY_NODE,
  FIELD_TEXT_NODE,
  FRONT_MATTER_NODE,
  PART_NODE,
  SECTION_NODE,
} from './schema'

export interface BlockingField {
  /** "Launch: Say is empty" */
  label: string
  /** A position inside the field (or at its node), for putting the caret there. */
  pos: number
}

const FIELD_NAMES: Record<string, string> = {
  'paragraph.text': 'Teacher note',
  'say.text': 'Say',
  'directions.text': 'Directions',
  'ask.question': 'Ask',
  'ask.exemplar': 'Exemplar',
  'connection.text': 'Connection',
  'display.text': 'Display',
  'teacher_tip.text': 'Teacher tip',
  'sentence_starter.text': 'Sentence starter',
  'pulse_check.stem': 'Pulse check question',
  'list.items': 'List',
  'body.title': 'Lesson title',
  'body.objectives': 'Objectives',
  'body.essentialQuestions': 'Essential questions',
  'body.connections': 'Connections',
  'body.materials': 'Materials',
  'body.vocabulary': 'Vocabulary',
  'body.homework': 'Homework',
}

function humanize(key: string): string {
  const words = key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

interface Step {
  node: PmNode
  pos: number
}

function children(step: Step): Step[] {
  const found: Step[] = []
  step.node.forEach((child, offset) => found.push({ node: child, pos: step.pos + 1 + offset }))
  return found
}

function describe(doc: PmNode, path: string[]): BlockingField | null {
  const body = children({ node: doc, pos: -1 }).find((c) => c.node.type.name === BODY_NODE)
  if (!body) return null
  const where: string[] = []
  let current: Step = body
  let blockType: string | null = null
  let fieldName: string | null = null
  let index = 1
  while (index < path.length) {
    const segment = path[index]!
    const next = path[index + 1]
    if (segment === 'sections' || segment === 'parts' || segment === 'blocks') {
      const typeName =
        segment === 'sections' ? SECTION_NODE : segment === 'parts' ? PART_NODE : null
      const list = children(current).filter((c) =>
        typeName ? c.node.type.name === typeName : blockTypeOf(c.node.type.name) !== null,
      )
      const found = list[Number(next)]
      if (!found) break
      current = found
      if (segment === 'sections') {
        where.push(SECTION_NAMES[parseData(found.node.toJSON()).kind as SectionKind])
      } else if (segment === 'parts') {
        const label = fieldText(found.node, 'label')
        const title = fieldText(found.node, 'title')
        const name = partName(label ?? undefined, title ?? undefined)
        if (name) where.push(name)
      } else {
        blockType = blockTypeOf(found.node.type.name)
      }
      index += 2
      continue
    }
    if (/^\d+$/.test(segment)) {
      const found = children(current)[Number(segment)]
      if (!found) break
      current = found
      fieldName = `${fieldName ?? 'Item'}, item ${Number(segment) + 1}`
      index += 1
      continue
    }
    const found = children(current).find((c) => c.node.attrs.key === segment)
    const scope = blockType ?? (current === body ? 'body' : '')
    const named = FIELD_NAMES[`${scope}.${segment}`]
    if (current === body && named) where.push(named)
    else fieldName = named ?? humanize(segment)
    if (!found) break
    current = found
    index += 1
  }
  if (fieldName?.startsWith('Item, ')) fieldName = fieldName.slice('Item, '.length)
  const place = where.join(', ')
  const what = fieldName ?? ''
  const name = [place, what].filter(Boolean).join(': ')
  const empty = current.node.type.name === FIELD_TEXT_NODE && current.node.textContent === ''
  return {
    label: empty ? `${name} is empty` : `${name} needs attention`,
    pos: current.node.isTextblock ? current.pos + 1 : current.pos,
  }
}

function fieldText(node: PmNode, key: string): string | null {
  let text: string | null = null
  node.forEach((child) => {
    if (child.attrs.key === key) text = child.textContent
  })
  return text
}

/** The first field that blocks saving, described for the reviewer, or null. */
export function describeBlockingField(
  doc: PmNode,
  errors: LessonValidationError[],
): BlockingField | null {
  const error = errors[0]
  if (!error) return null
  const path = error.path.split('.')
  if (path[0] === 'frontMatter') {
    let pos = 0
    doc.descendants((node, at) => {
      if (node.type.name === FRONT_MATTER_NODE) pos = at
      return pos === 0
    })
    return { label: `Front matter: ${humanize(path[1] ?? 'standards')} needs attention`, pos }
  }
  if (path[0] !== 'body') return null
  return describe(doc, path)
}
