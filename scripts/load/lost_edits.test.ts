import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { lessonToYDoc, yDocToLesson } from '../../src/editor/ydoc'
import { coreLessonContent } from '../../tests/fixtures/lesson/lesson_fixture'
import { contentText, findLostEdits, yjsText, type StoredLesson } from './lost_edits'
import { findTypingTarget, Typist } from './typist'

function typeMarker(typist: Typist, marker: string, typoAt = -1): void {
  ;[...marker].forEach((char, index) => {
    if (index === typoAt) {
      typist.type('x')
      typist.backspace()
    }
    typist.type(char)
  })
}

/** What the collab server would store for this document: its state and its lesson snapshot. */
function stored(lessonId: string, doc: Y.Doc): StoredLesson {
  const snapshot = yDocToLesson(doc)
  if (!snapshot.ok) throw new Error('snapshot is invalid')
  return { lessonId, yjsState: Y.encodeStateAsUpdate(doc), content: snapshot.lesson }
}

function exchange(a: Y.Doc, b: Y.Doc): void {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)))
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)))
}

describe('no-lost-edits checker (R28)', () => {
  it('finds nothing lost when every typed marker is stored', () => {
    const doc = lessonToYDoc(coreLessonContent())
    const typist = new Typist(doc, findTypingTarget(doc))
    typeMarker(typist, ' [m01-001]', 3)
    typeMarker(typist, ' [m01-002]')

    const lost = findLostEdits(
      [{ lessonId: 'L1', markers: [' [m01-001]', ' [m01-002]'] }],
      [stored('L1', doc)],
    )

    expect(lost).toEqual([])
    expect(yjsText(Y.encodeStateAsUpdate(doc))).toContain('[m01-001] [m01-002]')
  })

  it('types into the first body paragraph, not the title', () => {
    const doc = lessonToYDoc(coreLessonContent())
    typeMarker(new Typist(doc, findTypingTarget(doc)), ' [m09-001]')
    const snapshot = yDocToLesson(doc)
    expect(snapshot.ok).toBe(true)
    if (!snapshot.ok) return
    expect(snapshot.lesson.body.title).not.toContain('[m09-001]')
    expect(contentText(snapshot.lesson.body.sections)).toContain('[m09-001]')
  })

  it('keeps both co-editors markers whole when they type in the same paragraph at once', () => {
    const a = lessonToYDoc(coreLessonContent())
    const b = new Y.Doc()
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
    const typistA = new Typist(a, findTypingTarget(a))
    const typistB = new Typist(b, findTypingTarget(b))
    const markersA = [' [p1a-001]', ' [p1a-002]']
    const markersB = [' [p1b-001]', ' [p1b-002]']

    // Alternate keystrokes, syncing only every third one, so edits cross in flight.
    const keysA = markersA.join('')
    const keysB = markersB.join('')
    for (let i = 0; i < Math.max(keysA.length, keysB.length); i += 1) {
      if (keysA[i]) typistA.type(keysA[i]!)
      if (keysB[i]) typistB.type(keysB[i]!)
      if (i % 3 === 2) exchange(a, b)
      if (i === 5) {
        typistA.type('x')
        typistA.backspace()
      }
    }
    exchange(a, b)

    const lost = findLostEdits(
      [
        { lessonId: 'P1', markers: markersA },
        { lessonId: 'P1', markers: markersB },
      ],
      [stored('P1', a)],
    )
    expect(lost).toEqual([])
    expect(yjsText(Y.encodeStateAsUpdate(a))).toBe(yjsText(Y.encodeStateAsUpdate(b)))
  })

  it('reports a marker the stored Yjs state and snapshot do not have', () => {
    const doc = lessonToYDoc(coreLessonContent())
    const typist = new Typist(doc, findTypingTarget(doc))
    typeMarker(typist, ' [m02-001]')
    const before = stored('L2', doc)
    typeMarker(typist, ' [m02-002]')

    const lost = findLostEdits(
      [{ lessonId: 'L2', markers: [' [m02-001]', ' [m02-002]'] }],
      [before],
    )

    expect(lost).toEqual([
      { lessonId: 'L2', marker: ' [m02-002]', missingFrom: ['yjs', 'content'] },
    ])
  })

  it('reports a marker only the lesson snapshot lost (an invalid or skipped snapshot)', () => {
    const doc = lessonToYDoc(coreLessonContent())
    const original = stored('L3', doc).content
    typeMarker(new Typist(doc, findTypingTarget(doc)), ' [m03-001]')

    const lost = findLostEdits(
      [{ lessonId: 'L3', markers: [' [m03-001]'] }],
      [{ lessonId: 'L3', yjsState: Y.encodeStateAsUpdate(doc), content: original }],
    )

    expect(lost).toEqual([{ lessonId: 'L3', marker: ' [m03-001]', missingFrom: ['content'] }])
  })

  it('loses every marker of a lesson with nothing stored', () => {
    const lost = findLostEdits([{ lessonId: 'L4', markers: ['[a]', '[b]'] }], [])
    expect(lost).toEqual([
      { lessonId: 'L4', marker: '[a]', missingFrom: ['yjs', 'content'] },
      { lessonId: 'L4', marker: '[b]', missingFrom: ['yjs', 'content'] },
    ])
  })

  it('reads a marker that a bold mark splits', () => {
    const doc = lessonToYDoc(coreLessonContent())
    const text = findTypingTarget(doc)
    const at = text.length
    text.insert(at, ' [m05-')
    text.insert(at + 6, '001]', { bold: {} })
    expect(yjsText(Y.encodeStateAsUpdate(doc))).toContain(' [m05-001]')
  })
})
