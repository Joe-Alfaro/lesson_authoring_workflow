// R28 "no lost edits": every marker a simulated reviewer finished typing must be in what the
// server stored at the end, both in the Yjs state (yjs_documents) and in the lesson snapshot
// (lessons.content). Pure, so the check itself is unit tested (lost_edits.test.ts).
import * as Y from 'yjs'
import { LESSON_FRAGMENT } from '../../src/editor/ydoc'

/** The markers one lesson's editors typed, in any order. */
export interface TypedMarkers {
  lessonId: string
  markers: string[]
}

/** What the database holds for one lesson after the run. */
export interface StoredLesson {
  lessonId: string
  /** yjs_documents.state, or null when no row exists. */
  yjsState: Uint8Array | null
  /** lessons.content (JSON), or null. */
  content: unknown
}

export type StoreKind = 'yjs' | 'content'

export interface LostEdit {
  lessonId: string
  marker: string
  missingFrom: StoreKind[]
}

function collectText(node: Y.XmlElement | Y.XmlFragment | Y.XmlText, out: string[]): void {
  if (node instanceof Y.XmlText) {
    // The delta drops formatting (bold/italic), so a marker split by a mark still reads whole.
    const delta = node.toDelta() as { insert?: unknown }[]
    out.push(delta.map((op) => (typeof op.insert === 'string' ? op.insert : '')).join(''))
    return
  }
  node.toArray().forEach((child) => {
    if (child instanceof Y.XmlText || child instanceof Y.XmlElement) collectText(child, out)
  })
}

/** Every text of the lesson's Yjs document, one line per text node. */
export function yjsText(state: Uint8Array): string {
  const doc = new Y.Doc()
  try {
    Y.applyUpdate(doc, state)
    const out: string[] = []
    collectText(doc.getXmlFragment(LESSON_FRAGMENT), out)
    return out.join('\n')
  } finally {
    doc.destroy()
  }
}

/** Every string in the stored lesson JSON, one per line. */
export function contentText(content: unknown): string {
  const out: string[] = []
  const walk = (value: unknown): void => {
    if (typeof value === 'string') out.push(value)
    else if (Array.isArray(value)) value.forEach(walk)
    else if (value && typeof value === 'object') Object.values(value).forEach(walk)
  }
  walk(content)
  return out.join('\n')
}

/**
 * The typed markers missing from the stored Yjs state or the lesson snapshot. A lesson with
 * markers but no stored row loses all of them.
 */
export function findLostEdits(typed: TypedMarkers[], stored: StoredLesson[]): LostEdit[] {
  const byLesson = new Map(stored.map((lesson) => [lesson.lessonId, lesson]))
  const merged = new Map<string, string[]>()
  typed.forEach(({ lessonId, markers }) => {
    merged.set(lessonId, [...(merged.get(lessonId) ?? []), ...markers])
  })

  const lost: LostEdit[] = []
  merged.forEach((markers, lessonId) => {
    const lesson = byLesson.get(lessonId)
    const texts: Record<StoreKind, string> = {
      yjs: lesson?.yjsState ? yjsText(lesson.yjsState) : '',
      content: lesson?.content ? contentText(lesson.content) : '',
    }
    markers.forEach((marker) => {
      const missingFrom = (['yjs', 'content'] as const).filter(
        (kind) => !texts[kind].includes(marker),
      )
      if (missingFrom.length > 0) lost.push({ lessonId, marker, missingFrom })
    })
  })
  return lost
}
