'use client'
// The two Tiptap documents of the editor page: the live, collaborative lesson (R17, R18) and the
// read-only preview of an earlier version (R14). Both use the same schema and node views.
import type { Editor } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import { EditorContent, useEditor } from '@tiptap/react'
import { useEffect } from 'react'
import type { JSONContent } from '@tiptap/core'
import { lessonEditorExtensions } from '../../editor/schema'
import { RemoteSelectionFix } from '../../editor/remote_selection'
import { StructureGuard } from '../../editor/structure_guard'
import { LESSON_FRAGMENT } from '../../editor/ydoc'
import type { LessonCollab } from './collab'
import { CaretLabels, renderCaret } from './caret_labels'
import { userColour } from './collab'
import { lessonNodeViews, type EditorViewContext } from './node_views'
import { PacingWidget } from './pacing'

function attributes(label: string, editable: boolean): Record<string, string> {
  // Tiptap adds role="textbox" unless told otherwise; a locked lesson is a document, not a field.
  if (!editable) return { class: 'lesson-pm', role: 'document', 'aria-label': label }
  return {
    class: 'lesson-pm',
    role: 'textbox',
    'aria-multiline': 'true',
    'aria-label': label,
  }
}

export function LiveDocument({
  collab,
  ctx,
  label,
  user,
  initialContent,
  onEditor,
}: {
  collab: LessonCollab
  ctx: EditorViewContext
  label: string
  user: { id: string; name: string }
  initialContent: JSONContent | null
  onEditor: (editor: Editor | null) => void
}) {
  const editor = useEditor(
    {
      immediatelyRender: false,
      editable: ctx.editable,
      ...(initialContent ? { content: initialContent } : {}),
      extensions: [
        ...lessonEditorExtensions(lessonNodeViews(ctx)),
        StructureGuard,
        RemoteSelectionFix,
        CaretLabels,
        PacingWidget,
        Collaboration.configure({ document: collab.doc, field: LESSON_FRAGMENT }),
        CollaborationCaret.configure({
          provider: collab.provider,
          user: { id: user.id, name: user.name, color: userColour(user.id) },
          render: renderCaret,
          selectionRender: (person: Record<string, unknown>) => ({
            nodeName: 'span',
            class: 'rsel',
            style: `background-color: color-mix(in srgb, ${String(person.color)} 20%, transparent)`,
          }),
        }),
      ],
      editorProps: { attributes: attributes(label, ctx.editable) },
    },
    [],
  )
  useEffect(() => {
    onEditor(editor)
    return () => onEditor(null)
  }, [editor, onEditor])
  return <EditorContent editor={editor} />
}

export function PreviewDocument({
  content,
  ctx,
}: {
  content: JSONContent
  ctx: EditorViewContext
}) {
  const editor = useEditor(
    {
      immediatelyRender: false,
      editable: false,
      content,
      extensions: [...lessonEditorExtensions(lessonNodeViews(ctx)), PacingWidget],
      editorProps: { attributes: { class: 'lesson-pm', role: 'document' } },
    },
    [content],
  )
  return <EditorContent editor={editor} />
}
