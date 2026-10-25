// A ProseMirror editor state for a lesson, and its validated snapshot. Contract: src/editor/README.md.
import { EditorState } from '@tiptap/pm/state'
import type { LessonContent } from '../lesson/schema'
import { docToLesson, lessonToDoc, type SnapshotResult } from './convert'
import { lessonSchema } from './schema'

export function createLessonState(content: LessonContent): EditorState {
  return EditorState.create({
    schema: lessonSchema,
    doc: lessonSchema.nodeFromJSON(lessonToDoc(content)),
  })
}

export function stateToLesson(state: EditorState): SnapshotResult {
  return docToLesson(state.doc.toJSON())
}
