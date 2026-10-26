// Local-only AI assist previews in the live editor (R20, R21): the pending selection, the inline
// suggestion diff and the proposed section are decorations, so nothing reaches the shared Yjs
// document until the reviewer accepts. Accepting is one transaction (one undo step) that syncs
// like any edit. Browser only.
import type { JSONContent } from '@tiptap/core'
import { DOMSerializer, Fragment, type Node as PmNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { STRUCTURE_META } from '../../editor/commands'
import { parseInline, serializeInline } from '../../editor/inline'
import { blockTypeOf, FIELD_TEXT_NODE, SECTION_NODE } from '../../editor/schema'

export type SelectionPreview =
  | { kind: 'pending'; from: number; to: number }
  | { kind: 'suggestion'; from: number; to: number; suggestion: string }

export interface ProposalPreview {
  sectionId: string
  /** "Show current version": the current section shows, the proposal hides. */
  showCurrent: boolean
}

export interface AssistPreviewState {
  selection: SelectionPreview | null
  proposal: ProposalPreview | null
}

type AssistMeta = Partial<AssistPreviewState>

export const assistPreviewKey = new PluginKey<AssistPreviewState>('lessonAssistPreview')

/** The selection AI assist can work on: non-empty text inside one text field. */
export function assistableRange(state: EditorState): { from: number; to: number } | null {
  const { selection } = state
  if (!(selection instanceof TextSelection) || selection.empty) return null
  const { $from, $to } = selection
  if ($from.parent !== $to.parent || $from.parent.type.name !== FIELD_TEXT_NODE) return null
  if (state.doc.textBetween(selection.from, selection.to).trim() === '') return null
  return { from: selection.from, to: selection.to }
}

/** The selected text with **bold** / *italic* marks, as lesson text. */
export function rangeText(state: EditorState, from: number, to: number): string {
  const slice = state.doc.slice(from, to)
  const nodes: JSONContent[] = []
  slice.content.forEach((node) => nodes.push(node.toJSON() as JSONContent))
  return serializeInline(nodes)
}

/** Id of the block that holds `pos`, if any. */
export function blockIdAt(state: EditorState, pos: number): string | undefined {
  const $pos = state.doc.resolve(pos)
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth)
    if (blockTypeOf(node.type.name)) return String(node.attrs.id)
  }
  return undefined
}

/** Where the card goes: the end of the block holding the selection (else after the field). */
function cardPos(doc: PmNode, to: number): number {
  const $to = doc.resolve(to)
  for (let depth = $to.depth; depth > 0; depth -= 1) {
    if (blockTypeOf($to.node(depth).type.name)) return $to.end(depth)
  }
  return $to.after()
}

export function findSection(doc: PmNode, sectionId: string): { pos: number; node: PmNode } | null {
  let found: { pos: number; node: PmNode } | null = null
  doc.descendants((node, pos) => {
    if (found) return false
    if (node.type.name === SECTION_NODE && node.attrs.id === sectionId) {
      found = { pos, node }
      return false
    }
    return true
  })
  return found
}

function inlineNodes(state: EditorState, text: string): PmNode[] {
  return parseInline(text).map((json) => state.schema.nodeFromJSON(json))
}

function diffWidget(view: EditorView, from: number, to: number, suggestion: string): HTMLElement {
  const serializer = DOMSerializer.fromSchema(view.state.schema)
  const wrap = document.createElement('span')
  wrap.className = 'ai-diff'
  wrap.contentEditable = 'false'
  const removed = document.createElement('span')
  removed.className = 'del'
  removed.setAttribute('role', 'group')
  removed.setAttribute('aria-label', 'Removed text')
  removed.append(serializer.serializeFragment(view.state.doc.slice(from, to).content))
  const added = document.createElement('span')
  added.className = 'ins'
  added.setAttribute('role', 'group')
  added.setAttribute('aria-label', 'Suggested text')
  added.append(
    serializer.serializeFragment(Fragment.fromArray(inlineNodes(view.state, suggestion))),
  )
  wrap.append(removed, document.createTextNode(' '), added)
  return wrap
}

function decorations(
  state: EditorState,
  preview: AssistPreviewState,
  hosts: { card: HTMLElement; proposal: HTMLElement },
): DecorationSet {
  const decos: Decoration[] = []
  const { selection, proposal } = preview
  if (selection) {
    const { from, to } = selection
    if (selection.kind === 'pending') {
      decos.push(Decoration.inline(from, to, { class: 'mysel' }))
    } else {
      decos.push(Decoration.inline(from, to, { class: 'ai-hidden' }))
      decos.push(
        Decoration.widget(from, (view) => diffWidget(view, from, to, selection.suggestion), {
          side: -1,
          key: `ai-diff-${from}-${to}-${selection.suggestion}`,
          ignoreSelection: true,
        }),
      )
    }
    decos.push(
      Decoration.widget(cardPos(state.doc, to), hosts.card, {
        side: 1,
        key: 'ai-card',
        ignoreSelection: true,
        stopEvent: () => true,
      }),
    )
  }
  if (proposal) {
    const section = findSection(state.doc, proposal.sectionId)
    if (section) {
      decos.push(
        Decoration.node(section.pos, section.pos + section.node.nodeSize, {
          class: proposal.showCurrent ? 'ai-proposing show-current' : 'ai-proposing',
        }),
        Decoration.widget(section.pos + 1, hosts.proposal, {
          side: -1,
          key: 'ai-proposal',
          ignoreSelection: true,
          stopEvent: () => true,
        }),
      )
    }
  }
  return DecorationSet.create(state.doc, decos)
}

/** The preview plugin; React portals the cards into `hosts`. */
export function createAssistPreviewPlugin(hosts: {
  card: HTMLElement
  proposal: HTMLElement
}): Plugin<AssistPreviewState> {
  hosts.card.contentEditable = 'false'
  hosts.card.className = 'ai-card-host'
  hosts.proposal.contentEditable = 'false'
  hosts.proposal.className = 'ai-proposal-host'
  return new Plugin<AssistPreviewState>({
    key: assistPreviewKey,
    state: {
      init: () => ({ selection: null, proposal: null }),
      apply(tr, value) {
        const meta = tr.getMeta(assistPreviewKey) as AssistMeta | undefined
        let next = value
        if (tr.docChanged && next.selection) {
          const from = tr.mapping.map(next.selection.from, 1)
          const to = tr.mapping.map(next.selection.to, -1)
          next = { ...next, selection: from < to ? { ...next.selection, from, to } : null }
        }
        return meta ? { ...next, ...meta } : next
      },
    },
    props: {
      decorations(state) {
        const preview = assistPreviewKey.getState(state)
        if (!preview || (!preview.selection && !preview.proposal)) return null
        return decorations(state, preview, hosts)
      },
    },
  })
}

export function setPreview(view: EditorView, meta: AssistMeta): void {
  view.dispatch(view.state.tr.setMeta(assistPreviewKey, meta))
}

/** Replaces the previewed selection with the suggestion in one transaction (one undo step). */
export function acceptSuggestion(view: EditorView): boolean {
  const preview = assistPreviewKey.getState(view.state)?.selection
  if (preview?.kind !== 'suggestion') return false
  const nodes = inlineNodes(view.state, preview.suggestion)
  const tr = view.state.tr.replaceWith(preview.from, preview.to, nodes)
  const end = preview.from + Fragment.fromArray(nodes).size
  tr.setSelection(TextSelection.create(tr.doc, end))
  tr.setMeta(assistPreviewKey, { selection: null }).scrollIntoView()
  view.dispatch(tr)
  view.focus()
  return true
}

/** Swaps the proposed section in for the current one in one transaction (one undo step). */
export function acceptSection(view: EditorView, sectionJson: JSONContent): boolean {
  const id = String(sectionJson.attrs?.id ?? '')
  const section = findSection(view.state.doc, id)
  if (!section) return false
  const tr = view.state.tr
    .replaceWith(
      section.pos,
      section.pos + section.node.nodeSize,
      view.state.schema.nodeFromJSON(sectionJson),
    )
    .setMeta(STRUCTURE_META, true)
    .setMeta(assistPreviewKey, { proposal: null })
  view.dispatch(tr)
  return true
}
