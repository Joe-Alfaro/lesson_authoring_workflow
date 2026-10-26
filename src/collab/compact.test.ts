// Validation fix (M3): @tiptap/y-tiptap 3.0.10 wrote "position migration" records into the lesson's
// Yjs doc on every structural edit (~1.5 MB each, never pruned). Stored docs must stay near the
// size of their content: the collab server drops those records when it loads or stores a doc.
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { richLessonContent } from '../../tests/fixtures/lesson/rich_lesson_fixture'
import { lessonToYDoc, yDocToLesson } from '../editor/ydoc'
import { compactLessonDoc, isBloated } from './compact'

/** What y-tiptap 3.0.10 left behind: one map entry per structural edit, each ~1 KB+. */
function addMigrationRecords(doc: Y.Doc, count: number): void {
  const store = doc.getMap('__tiptap_position_migrations:root:default')
  doc.transact(() => {
    Array.from({ length: count }).forEach((_, index) => {
      store.set(`${doc.clientID}:${index}`, {
        version: 1,
        client: doc.clientID,
        clock: index,
        seen: [[doc.clientID, index]],
        transfers: Array.from({ length: 40 }, (_unused, n) => ({
          source: { client: doc.clientID, clock: n, length: 1 },
          target: { client: doc.clientID, clock: n + 1, type: null },
        })),
      })
    })
  })
}

function size(doc: Y.Doc): number {
  return Y.encodeStateAsUpdate(doc).byteLength
}

describe('compactLessonDoc', () => {
  it('drops position migration records, keeping the lesson', () => {
    const fresh = size(lessonToYDoc(richLessonContent()))
    const doc = lessonToYDoc(richLessonContent())
    addMigrationRecords(doc, 200)
    const bloated = size(doc)
    expect(bloated).toBeGreaterThan(fresh * 5)

    expect(compactLessonDoc(doc)).toBe(true)
    // What's left of a deleted record is a small tombstone.
    expect(size(doc)).toBeLessThan(fresh + 200 * 100)
    expect(yDocToLesson(doc)).toEqual({ ok: true, lesson: richLessonContent() })
  })

  it('calls a doc bloated when it is far larger than its lesson, so the server rebuilds it', () => {
    const doc = lessonToYDoc(richLessonContent())
    expect(isBloated(doc, richLessonContent())).toBe(false)
    addMigrationRecords(doc, 20_000)
    compactLessonDoc(doc)
    expect(isBloated(doc, richLessonContent())).toBe(true)
  })

  it('keeps the lesson items, so a client holding the old doc merges without duplicates', () => {
    const server = lessonToYDoc(richLessonContent())
    addMigrationRecords(server, 50)
    const client = new Y.Doc()
    Y.applyUpdate(client, Y.encodeStateAsUpdate(server))

    compactLessonDoc(server)
    Y.applyUpdate(server, Y.encodeStateAsUpdate(client))
    Y.applyUpdate(client, Y.encodeStateAsUpdate(server))
    expect(yDocToLesson(server)).toEqual({ ok: true, lesson: richLessonContent() })
    expect(yDocToLesson(client)).toEqual({ ok: true, lesson: richLessonContent() })
  })

  it('does nothing to a doc without records', () => {
    const doc = lessonToYDoc(richLessonContent())
    const before = size(doc)
    expect(compactLessonDoc(doc)).toBe(false)
    expect(size(doc)).toBe(before)
  })
})
