// Validation fixes (M3, R17): a new block or part gets the caret, a new part has a label and a
// title to type into, and a part's minutes and standards can be set (standards from the
// reference data only).
import type { Command, EditorState } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'
import ccss from '../../tests/fixtures/standards/ccss_fixture.json'
import { richLessonContent } from '../../tests/fixtures/lesson/rich_lesson_fixture'
import type { LessonContent } from '../lesson/schema'
import {
  addBlock,
  addPart,
  addPartStandard,
  findById,
  removeListItemAt,
  removePartStandard,
  setPartMinutes,
} from './commands'
import { blockNodeName, PART_NODE } from './schema'
import { createLessonState, stateToLesson } from './state'
import type { StandardRef } from './standards'

const REFERENCE = ccss.map((s) => ({
  code: s.code,
  framework: s.framework as StandardRef['framework'],
  strand: s.strand,
  text: s.text,
}))

function run(state: EditorState, command: Command) {
  let next = state
  const applied = command(state, (tr) => {
    next = state.apply(tr)
  })
  return { applied, state: next }
}

function newNodes(before: EditorState, after: EditorState, typeName: string) {
  const ids = (state: EditorState) => {
    const found: string[] = []
    state.doc.descendants((node) => {
      if (node.type.name === typeName) found.push(String(node.attrs.id))
    })
    return found
  }
  const old = new Set(ids(before))
  return ids(after).filter((id) => !old.has(id))
}

function lessonOf(state: EditorState): LessonContent {
  const result = stateToLesson(state)
  if (!result.ok) throw new Error(JSON.stringify(result.errors))
  return result.lesson
}

/** The `key` of the field holding the caret, and the id of the node around it with an id. */
function caretField(state: EditorState): { key: unknown; id: unknown } {
  const { $from } = state.selection
  const owner = Array.from({ length: $from.depth }, (_, i) => $from.node($from.depth - i)).find(
    (node) => typeof node.attrs.id === 'string',
  )
  return { key: $from.parent.attrs.key, id: owner?.attrs.id }
}

describe('caret after adding', () => {
  it('puts the caret in the first text field of a new block', () => {
    const start = createLessonState(richLessonContent())
    const { state } = run(start, addBlock('b-say', 'ask'))
    const [askId] = newNodes(start, state, blockNodeName('ask'))
    expect(caretField(state)).toEqual({ key: 'question', id: askId })
  })

  it('gives a new Learning in Action part the next label and an empty title, with the caret in it', () => {
    const start = createLessonState(richLessonContent())
    const { state } = run(start, addPart('sec-action'))
    const [partId] = newNodes(start, state, PART_NODE)
    expect(caretField(state)).toEqual({ key: 'title', id: partId })
    // Invalid until filled in (the paragraph is empty), so read the doc node.
    const node = findById(state.doc, partId!)!.node
    const keys: unknown[] = []
    node.forEach((child) => keys.push(child.attrs.key))
    expect(keys.slice(0, 2)).toEqual(['label', 'title'])
    expect(node.child(0).textContent).toBe('C')
  })
})

describe('part minutes and standards', () => {
  it('sets and clears a part’s minutes', () => {
    const set = run(createLessonState(richLessonContent()), setPartMinutes('part-b', 15))
    expect(set.applied).toBe(true)
    const partB = lessonOf(set.state).body.sections[2]!.parts[1]!
    expect(partB.minutes).toBe(15)
    const cleared = run(set.state, setPartMinutes('part-b', null))
    expect('minutes' in lessonOf(cleared.state).body.sections[2]!.parts[1]!).toBe(false)
    expect(run(set.state, setPartMinutes('part-b', 0)).applied).toBe(false)
  })

  it('adds a reference standard to a part and removes it', () => {
    const lesson = richLessonContent()
    const added = run(createLessonState(lesson), addPartStandard('part-b', 'L.6.4', REFERENCE))
    expect(added.applied).toBe(true)
    expect(lessonOf(added.state).body.sections[2]!.parts[1]!.standards).toEqual([
      'RL.6.1',
      'RL.6.2',
      'L.6.4',
    ])
    expect(run(added.state, addPartStandard('part-b', 'L.6.4', REFERENCE)).applied).toBe(false)
    expect(run(added.state, addPartStandard('part-b', 'XX.9.9', REFERENCE)).applied).toBe(false)
    const removed = run(added.state, removePartStandard('part-b', 'RL.6.2'))
    expect(lessonOf(removed.state).body.sections[2]!.parts[1]!.standards).toEqual([
      'RL.6.1',
      'L.6.4',
    ])
  })
})

describe('removing a list item from the editor', () => {
  it('removes the item holding the caret and puts the caret at the end of the one before', () => {
    const state = createLessonState(richLessonContent())
    const list = findById(state.doc, 'b-list')!
    let itemPos = -1
    list.node.descendants((node, pos) => {
      if (itemPos < 0 && node.isTextblock && node.textContent === 'Name the detail.') {
        itemPos = list.pos + 1 + pos
      }
    })
    const { applied, state: after } = run(state, removeListItemAt(itemPos + 1))
    expect(applied).toBe(true)
    const items = lessonOf(after).body.sections[1]!.parts[0]!.blocks.find((b) => b.id === 'b-list')
    expect(items).toMatchObject({ items: ['Read the sentence aloud.', 'Say the inference.'] })
    expect(after.selection.$from.parent.textContent).toBe('Read the sentence aloud.')
    expect(after.selection.$from.parentOffset).toBe('Read the sentence aloud.'.length)
  })
})
