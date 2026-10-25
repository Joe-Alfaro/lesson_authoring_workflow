// Lesson text is a plain string with **bold** and *italic* only (D-016). In the editor those are
// bold/italic marks on text nodes; these two functions convert between the forms losslessly.
import type { JSONContent } from '@tiptap/core'

type MarkName = 'bold' | 'italic'

interface Run {
  text: string
  bold: boolean
  italic: boolean
}

/** Splits `**` / `*` toggles; returns null when a toggle is left open (then the text is literal). */
function runsOf(source: string): Run[] | null {
  const runs: Run[] = []
  const state = { bold: false, italic: false, text: '' }
  const flush = () => {
    if (state.text) runs.push({ text: state.text, bold: state.bold, italic: state.italic })
    state.text = ''
  }
  const tokens = source.split(/(\*\*|\*)/)
  tokens.forEach((token) => {
    if (token === '**') {
      flush()
      state.bold = !state.bold
    } else if (token === '*') {
      flush()
      state.italic = !state.italic
    } else {
      state.text += token
    }
  })
  flush()
  if (state.bold || state.italic) return null
  return runs
}

/** `**bold**` / `*italic*` text -> ProseMirror text nodes with marks (no empty text nodes). */
export function parseInline(source: string): JSONContent[] {
  const runs = runsOf(source) ?? (source ? [{ text: source, bold: false, italic: false }] : [])
  return runs.map((run) => {
    const marks: { type: MarkName }[] = []
    if (run.bold) marks.push({ type: 'bold' })
    if (run.italic) marks.push({ type: 'italic' })
    return marks.length > 0
      ? { type: 'text', text: run.text, marks }
      : { type: 'text', text: run.text }
  })
}

/** ProseMirror text nodes -> `**bold**` / `*italic*` text, toggling only where marks change. */
export function serializeInline(content: JSONContent[] | undefined): string {
  const state = { bold: false, italic: false, out: '' }
  const nodes = (content ?? []).filter((node) => node.type === 'text')
  nodes.forEach((node) => {
    const names = new Set((node.marks ?? []).map((mark) => mark.type))
    const bold = names.has('bold')
    const italic = names.has('italic')
    if (state.italic && !italic) {
      state.out += '*'
      state.italic = false
    }
    if (state.bold !== bold) {
      // Close italic around a bold change so the toggles nest and parse back the same way.
      if (state.italic) state.out += '*'
      state.out += '**'
      if (state.italic) state.out += '*'
      state.bold = bold
    }
    if (!state.italic && italic) {
      state.out += '*'
      state.italic = true
    }
    state.out += node.text ?? ''
  })
  if (state.italic) state.out += '*'
  if (state.bold) state.out += '**'
  return state.out
}
