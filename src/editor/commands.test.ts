// R17: a reviewer can edit text, add and remove list items, parts and prompts (Ask blocks), and the
// result still validates against the lesson schema. Front-matter standards come only from the
// reference data (R15/R17). Contract: src/editor/README.md.
import type { Node as PmNode } from '@tiptap/pm/model'
import type { Command, EditorState } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'
import ccss from '../../tests/fixtures/standards/ccss_fixture.json'
import eld from '../../tests/fixtures/standards/eld_fixture.json'
import library from '../../tests/fixtures/standards/library_fixture.json'
import { RICH_FOCUS, richLessonContent } from '../../tests/fixtures/lesson/rich_lesson_fixture'
import { validateLesson, type LessonContent } from '../lesson/schema'
import { addBlock, addListItem, addPart, removeBlock, removeListItem, removePart } from './commands'
import { blockNodeName, PART_NODE } from './schema'
import { createLessonState, stateToLesson } from './state'
import { addStandard, removeStandard, searchStandards, type StandardRef } from './standards'

const REFERENCE: StandardRef[] = [...ccss, ...eld, ...library].map((s) => ({
  code: s.code,
  framework: s.framework as StandardRef['framework'],
  strand: s.strand,
  text: s.text,
}))

function run(state: EditorState, command: Command): { applied: boolean; state: EditorState } {
  let next = state
  const applied = command(state, (tr) => {
    next = state.apply(tr)
  })
  return { applied, state: next }
}

function lessonOf(state: EditorState): LessonContent {
  const result = stateToLesson(state)
  if (!result.ok) {
    throw new Error(`Expected a valid lesson: ${JSON.stringify(result.errors)}`)
  }
  return result.lesson
}

function expectValid(state: EditorState) {
  const lesson = lessonOf(state)
  expect(validateLesson(lesson, { focusStandards: RICH_FOCUS, days: 1 })).toMatchObject({
    ok: true,
  })
  return lesson
}

/** Position and node of the node with this id attribute. */
function findById(doc: PmNode, id: string): { pos: number; node: PmNode } {
  let found: { pos: number; node: PmNode } | undefined
  doc.descendants((node, pos) => {
    if (!found && node.attrs.id === id) found = { pos, node }
    return !found
  })
  if (!found) throw new Error(`No node with id ${id}`)
  return found
}

/** Textblocks inside a node, in document order, as end-of-text positions. */
function textblockEnds(state: EditorState, id: string): number[] {
  const { pos, node } = findById(state.doc, id)
  const ends: number[] = []
  node.descendants((child, childPos) => {
    if (child.isTextblock) ends.push(pos + 1 + childPos + child.nodeSize - 1)
    return !child.isTextblock
  })
  return ends
}

function typeAt(state: EditorState, pos: number, text: string): EditorState {
  return state.apply(state.tr.insertText(text, pos))
}

/** Ids of nodes of this type that are in `after` but not in `before`. */
function newIds(before: EditorState, after: EditorState, typeName: string): string[] {
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

function blocksOfPart(lesson: LessonContent, partId: string) {
  const part = lesson.body.sections.flatMap((s) => s.parts).find((p) => p.id === partId)
  if (!part) throw new Error(`No part ${partId}`)
  return part.blocks
}

describe('editing the lesson in the editor state', () => {
  it('starts from a state whose snapshot is the lesson itself', () => {
    expect(stateToLesson(createLessonState(richLessonContent()))).toEqual({
      ok: true,
      lesson: richLessonContent(),
    })
  })

  it('typing into a Say block changes only that text and stays valid', () => {
    const state = createLessonState(richLessonContent())
    const [end] = textblockEnds(state, 'b-say')
    const lesson = expectValid(typeAt(state, end!, ' Listen closely.'))
    const expected = richLessonContent()
    const say = expected.body.sections[0]!.parts[0]!.blocks[1]!
    if (say.type !== 'say') throw new Error('fixture changed')
    say.text = `${say.text} Listen closely.`
    expect(lesson).toEqual(expected)
  })

  it('adds a prompt (Ask with exemplar) after a block; it validates once both are filled in', () => {
    const start = createLessonState(richLessonContent())
    const added = run(start, addBlock('b-say', 'ask'))
    expect(added.applied).toBe(true)
    const [askId] = newIds(start, added.state, blockNodeName('ask'))
    expect(askId).toBeTruthy()
    // Empty question and exemplar do not validate yet.
    expect(stateToLesson(added.state).ok).toBe(false)

    const [questionEnd] = textblockEnds(added.state, askId!)
    let state = typeAt(added.state, questionEnd!, 'Who is telling the story?')
    const [, exemplarEnd] = textblockEnds(state, askId!)
    state = typeAt(state, exemplarEnd!, 'A kid who is in trouble at school.')

    const blocks = blocksOfPart(expectValid(state), 'part-launch')
    expect(blocks.map((b) => b.id)).toEqual(['b-routine', 'b-say', askId, 'b-ask', 'b-connection'])
    expect(blocks[2]).toEqual({
      type: 'ask',
      id: askId,
      question: 'Who is telling the story?',
      exemplar: 'A kid who is in trouble at school.',
    })
  })

  it('removes a prompt and stays valid', () => {
    const { applied, state } = run(createLessonState(richLessonContent()), removeBlock('b-ask'))
    expect(applied).toBe(true)
    const blocks = blocksOfPart(expectValid(state), 'part-launch')
    expect(blocks.map((b) => b.id)).toEqual(['b-routine', 'b-say', 'b-connection'])
  })

  it('refuses to remove the last block of a part', () => {
    const { applied, state } = run(createLessonState(richLessonContent()), removeBlock('b-rubric'))
    expect(applied).toBe(false)
    expect(lessonOf(state)).toEqual(richLessonContent())
  })

  it('adds a list item that validates once filled in, and removes one', () => {
    const start = createLessonState(richLessonContent())
    const added = run(start, addListItem('b-list'))
    expect(added.applied).toBe(true)
    expect(stateToLesson(added.state).ok).toBe(false)
    const ends = textblockEnds(added.state, 'b-list')
    const state = typeAt(added.state, ends[ends.length - 1]!, 'Write the inference down.')
    const list = blocksOfPart(expectValid(state), 'part-lab').find((b) => b.id === 'b-list')
    expect(list).toMatchObject({
      items: [
        'Read the sentence aloud.',
        'Name the detail.',
        'Say the inference.',
        'Write the inference down.',
      ],
    })

    const removed = run(state, removeListItem('b-list', 1))
    expect(removed.applied).toBe(true)
    expect(
      blocksOfPart(expectValid(removed.state), 'part-lab').find((b) => b.id === 'b-list'),
    ).toMatchObject({
      items: ['Read the sentence aloud.', 'Say the inference.', 'Write the inference down.'],
    })
  })

  it('refuses to remove the only list item', () => {
    const lesson = richLessonContent()
    const list = lesson.body.sections[1]!.parts[0]!.blocks.find((b) => b.id === 'b-list')!
    if (list.type !== 'list') throw new Error('fixture changed')
    list.items = ['Only item.']
    const { applied } = run(createLessonState(lesson), removeListItem('b-list', 0))
    expect(applied).toBe(false)
  })

  it('adds a part to Learning in Action (one empty paragraph) that validates once filled in', () => {
    const start = createLessonState(richLessonContent())
    const added = run(start, addPart('sec-action'))
    expect(added.applied).toBe(true)
    const [partId] = newIds(start, added.state, PART_NODE)
    const [paragraphId] = newIds(start, added.state, blockNodeName('paragraph'))
    expect(partId && paragraphId).toBeTruthy()
    expect(stateToLesson(added.state).ok).toBe(false)

    const [end] = textblockEnds(added.state, paragraphId!)
    const lesson = expectValid(typeAt(added.state, end!, 'Partners share their best inference.'))
    const action = lesson.body.sections.find((s) => s.id === 'sec-action')!
    expect(action.parts.map((p) => p.id)).toEqual(['part-a', 'part-b', partId])
    expect(action.parts[2]).toMatchObject({
      standards: [],
      blocks: [
        { type: 'paragraph', id: paragraphId, text: 'Partners share their best inference.' },
      ],
    })
  })

  it('removes a part, and refuses to remove the only part of a section', () => {
    const removed = run(createLessonState(richLessonContent()), removePart('part-b'))
    expect(removed.applied).toBe(true)
    const lesson = lessonOf(removed.state)
    expect(lesson.body.sections.find((s) => s.id === 'sec-action')!.parts.map((p) => p.id)).toEqual(
      ['part-a'],
    )
    expect(run(createLessonState(richLessonContent()), removePart('part-launch')).applied).toBe(
      false,
    )
  })

  it('does nothing for an unknown id', () => {
    const state = createLessonState(richLessonContent())
    expect(run(state, addBlock('missing', 'say')).applied).toBe(false)
    expect(run(state, removeBlock('missing')).applied).toBe(false)
    expect(run(state, addPart('missing')).applied).toBe(false)
  })
})

describe('front-matter standards come only from the reference data (R15, R17)', () => {
  it('searches codes by prefix and texts by word, case-insensitively', () => {
    expect(searchStandards(REFERENCE, 'rl.6').map((s) => s.code)).toEqual(['RL.6.1'])
    expect(searchStandards(REFERENCE, 'language').map((s) => s.code)).toContain('L.6.4')
    expect(searchStandards(REFERENCE, 'ZZ.9.9')).toEqual([])
  })

  it('leaves out codes already chosen', () => {
    expect(searchStandards(REFERENCE, 'L.6', { exclude: ['L.6.4'] }).map((s) => s.code)).toEqual([])
  })

  it('adds a reference standard as a chip to focus or supporting standards', () => {
    const lesson = richLessonContent()
    lesson.frontMatter.supportingStandards = []
    const { applied, state } = run(
      createLessonState(lesson),
      addStandard('supportingStandards', 'L.6.4', REFERENCE),
    )
    expect(applied).toBe(true)
    expect(lessonOf(state).frontMatter.supportingStandards).toEqual(['L.6.4'])
  })

  it('refuses a code that is not in the reference data (no free text)', () => {
    const state = createLessonState(richLessonContent())
    const { applied, state: after } = run(
      state,
      addStandard('focusStandards', 'RL.6.99', REFERENCE),
    )
    expect(applied).toBe(false)
    expect(lessonOf(after).frontMatter.focusStandards).toEqual(RICH_FOCUS)
  })

  it('refuses a duplicate, and an ELD code outside the ELD group', () => {
    const state = createLessonState(richLessonContent())
    expect(run(state, addStandard('focusStandards', 'RL.6.1', REFERENCE)).applied).toBe(false)
    expect(run(state, addStandard('focusStandards', 'ELD.PI.6.6', REFERENCE)).applied).toBe(false)
    expect(run(state, addStandard('eldStandards', 'RL.6.1', REFERENCE)).applied).toBe(false)
  })

  it('adds an ELD standard with all three levels', () => {
    const lesson = richLessonContent()
    lesson.frontMatter.eldStandards = []
    const { applied, state } = run(
      createLessonState(lesson),
      addStandard('eldStandards', 'ELD.PI.6.6', REFERENCE),
    )
    expect(applied).toBe(true)
    expect(lessonOf(state).frontMatter.eldStandards).toEqual([
      { code: 'ELD.PI.6.6', levels: ['Em', 'Ex', 'Br'] },
    ])
  })

  it('removes a chip but keeps at least one focus standard', () => {
    const state = createLessonState(richLessonContent())
    const removed = run(state, removeStandard('focusStandards', 'RL.6.2'))
    expect(removed.applied).toBe(true)
    expect(lessonOf(removed.state).frontMatter.focusStandards).toEqual(['RL.6.1'])
    expect(run(removed.state, removeStandard('focusStandards', 'RL.6.1')).applied).toBe(false)
  })

  it('cannot type a standard code into a chip: chips are atoms', () => {
    const state = createLessonState(richLessonContent())
    const { pos, node } = findStandardChip(state, 'RL.6.1')
    expect(node.isAtom).toBe(true)
    expect(node.isLeaf).toBe(true)
    expect(pos).toBeGreaterThan(0)
  })
})

function findStandardChip(state: EditorState, code: string): { pos: number; node: PmNode } {
  let found: { pos: number; node: PmNode } | undefined
  state.doc.descendants((node, pos) => {
    if (!found && node.attrs.code === code) found = { pos, node }
    return !found
  })
  if (!found) throw new Error(`No chip for ${code}`)
  return found
}
