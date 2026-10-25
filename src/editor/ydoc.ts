// The lesson as a Yjs document, the y-prosemirror way (one Y.XmlElement per node, attributes as
// element attributes, text in Y.XmlText). Contract: src/editor/README.md.
import { Node as PmNode } from '@tiptap/pm/model'
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap'
import * as Y from 'yjs'
import type { LessonContent } from '../lesson/schema'
import { docToLesson, lessonToDoc, type SnapshotResult } from './convert'
import { lessonSchema } from './schema'

/** The Y.XmlFragment the Tiptap Collaboration extension uses by default. */
export const LESSON_FRAGMENT = 'default'

export { lessonDocumentName, lessonIdOf } from './document_name'

/** Writes the lesson into a fragment (which should be empty) in one Yjs transaction. */
export function writeLesson(fragment: Y.XmlFragment, content: LessonContent): void {
  prosemirrorJSONToYXmlFragment(lessonSchema, lessonToDoc(content), fragment)
}

export function lessonToYDoc(content: LessonContent): Y.Doc {
  const doc = new Y.Doc()
  writeLesson(doc.getXmlFragment(LESSON_FRAGMENT), content)
  return doc
}

export function yDocToLesson(doc: Y.Doc): SnapshotResult {
  const json = yXmlFragmentToProsemirrorJSON(doc.getXmlFragment(LESSON_FRAGMENT))
  try {
    // Through the schema, so attributes the Yjs side omits get their defaults.
    return docToLesson(PmNode.fromJSON(lessonSchema, json).toJSON())
  } catch (error) {
    return {
      ok: false,
      errors: [
        {
          code: 'schema',
          path: '(root)',
          message: `The Yjs document is not a valid lesson document: ${(error as Error).message}`,
        },
      ],
    }
  }
}
