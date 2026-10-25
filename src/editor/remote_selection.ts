// Keeps the local caret in place when a collaborator edits the same field (R18). After a remote
// Yjs change, @tiptap/y-tiptap 3.0.x restores the selection with a "structural change" fallback
// whenever the caret's paragraph text changed, keeping the old offset; a collaborator typing
// earlier in the paragraph then pushes our caret one character left per keystroke, and our own
// typing comes out reversed. This plugin maps the caret by diffing the field's old and new text.
import { Extension } from '@tiptap/core'
import type { Node as PmNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state'
import { ySyncPluginKey } from '@tiptap/y-tiptap'

interface FieldAddress {
  /** Nearest ancestor with an id (block, part, section), if any. */
  id: string | null
  /** Child indexes from that ancestor (or the doc) down to the textblock. */
  path: number[]
}

function addressOf(state: EditorState, pos: number): FieldAddress | null {
  const $pos = state.doc.resolve(pos)
  if (!$pos.parent.isTextblock) return null
  const path: number[] = []
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    path.unshift($pos.index(depth - 1))
    const ancestor = $pos.node(depth - 1)
    if (typeof ancestor.attrs.id === 'string' && ancestor.attrs.id) {
      return { id: ancestor.attrs.id, path }
    }
  }
  return { id: null, path }
}

/** Start position (inside) and node of the textblock at an address. */
function locate(doc: PmNode, address: FieldAddress): { start: number; node: PmNode } | null {
  let base: { pos: number; node: PmNode } | null = { pos: -1, node: doc }
  if (address.id) {
    base = null
    doc.descendants((node, pos) => {
      if (base) return false
      if (node.attrs.id === address.id) base = { pos, node }
      return !base
    })
  }
  if (!base) return null
  let { pos, node } = base as { pos: number; node: PmNode }
  for (const index of address.path) {
    if (index >= node.childCount) return null
    let offset = 0
    for (let i = 0; i < index; i += 1) offset += node.child(i).nodeSize
    pos = pos + 1 + offset
    node = node.child(index)
  }
  return node.isTextblock ? { start: pos + 1, node } : null
}

/** Where `offset` in `before` lands in `after`, assuming one contiguous change. */
export function mapTextOffset(before: string, after: string, offset: number): number {
  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
    prefix += 1
  }
  let suffix = 0
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1
  }
  if (offset <= prefix) return offset
  if (offset >= before.length - suffix) return offset + (after.length - before.length)
  return Math.min(prefix + (after.length - before.length) + (offset - prefix), after.length)
}

function textOf(node: PmNode): string {
  return node.textBetween(0, node.content.size, undefined, '￼')
}

export const RemoteSelectionFix = Extension.create({
  name: 'lessonRemoteSelectionFix',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('lessonRemoteSelectionFix'),
        appendTransaction(transactions, oldState, newState) {
          const remote = transactions.some(
            (tr) => tr.docChanged && tr.getMeta(ySyncPluginKey)?.isChangeOrigin,
          )
          const { selection } = oldState
          if (!remote || !selection.empty) return null
          const address = addressOf(oldState, selection.head)
          if (!address) return null
          const before = locate(oldState.doc, address)
          const after = locate(newState.doc, address)
          if (!before || !after) return null
          const offset = selection.head - before.start
          const mapped =
            after.start + mapTextOffset(textOf(before.node), textOf(after.node), offset)
          if (mapped === newState.selection.head) return null
          return newState.tr
            .setSelection(TextSelection.create(newState.doc, mapped))
            .setMeta('addToHistory', false)
        },
      }),
    ]
  },
})
