// Keeps the lesson shape intact while people type (R17): edits typed or pasted by a person stay
// inside one text field, so Enter, Backspace across fields or a multi-paragraph paste can't split,
// merge or delete fields. Structural changes come only from the commands (STRUCTURE_META) and from
// collaborators through Yjs. Enter in a list item adds the next item.
import { Extension } from '@tiptap/core'
import type { Fragment, Node as PmNode, Slice } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection, type Transaction } from '@tiptap/pm/state'
import { AddMarkStep, RemoveMarkStep, ReplaceStep, type Step } from '@tiptap/pm/transform'
import { ySyncPluginKey } from '@tiptap/y-tiptap'
import { STRUCTURE_META } from './commands'
import { FIELD_LIST_NODE, FIELD_TEXT_NODE } from './schema'

/** A slice that, once its open ends are unwrapped, is only inline content. */
function isInlineSlice(slice: Slice): boolean {
  if (slice.openStart !== slice.openEnd) return false
  const inner = Array.from({ length: slice.openStart }).reduce<Fragment | null>(
    (content) => (content && content.childCount === 1 ? content.firstChild!.content : null),
    slice.content,
  )
  if (!inner) return false
  let inline = true
  inner.forEach((node) => {
    if (!node.isInline) inline = false
  })
  return inline
}

function stepStaysInField(step: Step, doc: PmNode): boolean {
  if (!(step instanceof ReplaceStep)) {
    // Mark steps are fine (bold, italic); anything structural is not.
    return step instanceof AddMarkStep || step instanceof RemoveMarkStep
  }
  const { from, to, slice } = step as unknown as { from: number; to: number; slice: Slice }
  const $from = doc.resolve(from)
  const $to = doc.resolve(to)
  return $from.parent === $to.parent && $from.parent.isTextblock && isInlineSlice(slice)
}

export function isFieldEdit(tr: Transaction): boolean {
  return tr.steps.every((step, index) => stepStaysInField(step, tr.docs[index]!))
}

function isTrusted(tr: Transaction): boolean {
  return Boolean(tr.getMeta(STRUCTURE_META) || tr.getMeta(ySyncPluginKey))
}

export const StructureGuard = Extension.create({
  name: 'lessonStructureGuard',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('lessonStructureGuard'),
        filterTransaction: (tr) => !tr.docChanged || isTrusted(tr) || isFieldEdit(tr),
      }),
    ]
  },
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { state } = editor
        const { $from, empty } = state.selection
        const field = $from.parent
        const list = $from.node($from.depth - 1)
        if (!empty || field.type.name !== FIELD_TEXT_NODE || list?.type.name !== FIELD_LIST_NODE) {
          // Fields are single paragraphs: Enter does nothing rather than splitting one.
          return true
        }
        const after = $from.after()
        const item = state.schema.nodes[FIELD_TEXT_NODE]!.create({ key: null })
        const tr = state.tr.insert(after, item).setMeta(STRUCTURE_META, true)
        tr.setSelection(TextSelection.create(tr.doc, after + 1))
        editor.view.dispatch(tr)
        return true
      },
      'Shift-Enter': () => true,
    }
  },
})
