// R18: each remote caret shows its person's name. The caret itself is a bar inside the text;
// the name tags live in one overlay layer at the end of the document, positioned over the carets,
// so a name never sits inside a paragraph's text (copying or reading the text stays clean).
// Browser only.
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

const CARET_SELECTOR = '.rc[data-name]'

/** Remote caret: a 2px bar in the person's colour (aria-hidden); its tag is drawn by the layer. */
export function renderCaret(user: Record<string, unknown>): HTMLElement {
  const colour = String(user.color ?? '#1d4ed8')
  const caret = document.createElement('span')
  caret.className = 'rc'
  caret.setAttribute('aria-hidden', 'true')
  caret.dataset.name = String(user.name ?? '')
  caret.dataset.colour = colour
  const bar = document.createElement('span')
  bar.className = 'caret'
  bar.style.background = colour
  caret.append(bar)
  return caret
}

function positionLabels(view: EditorView, layer: HTMLElement): void {
  const frame = layer.offsetParent ?? view.dom
  const origin = frame.getBoundingClientRect()
  const carets = [...view.dom.querySelectorAll<HTMLElement>(CARET_SELECTOR)]
  const labels = carets.map((caret) => {
    const rect = caret.getBoundingClientRect()
    const tag = document.createElement('span')
    tag.className = 'tag caret-tag'
    tag.textContent = caret.dataset.name ?? ''
    tag.style.background = caret.dataset.colour ?? ''
    tag.style.left = `${rect.left - origin.left}px`
    tag.style.top = `${rect.top - origin.top - 17}px`
    return tag
  })
  const same =
    labels.length === layer.childElementCount &&
    labels.every((label, index) => {
      const current = layer.children[index] as HTMLElement
      return (
        current.textContent === label.textContent &&
        current.style.left === label.style.left &&
        current.style.top === label.style.top
      )
    })
  if (!same) layer.replaceChildren(...labels)
}

export const CaretLabels = Extension.create({
  name: 'lessonCaretLabels',
  addProseMirrorPlugins() {
    const layer = document.createElement('div')
    layer.className = 'caret-layer'
    layer.setAttribute('aria-hidden', 'true')
    layer.contentEditable = 'false'
    return [
      new Plugin({
        key: new PluginKey('lessonCaretLabels'),
        props: {
          decorations: (state) => {
            const end = state.doc.content.size - 1
            if (end < 0) return DecorationSet.empty
            return DecorationSet.create(state.doc, [
              Decoration.widget(end, () => layer, {
                side: 1,
                key: 'caret-layer',
                ignoreSelection: true,
              }),
            ])
          },
        },
        view: (view) => {
          let frame = 0
          const schedule = () => {
            cancelAnimationFrame(frame)
            frame = requestAnimationFrame(() => positionLabels(view, layer))
          }
          window.addEventListener('resize', schedule)
          schedule()
          return {
            update: schedule,
            destroy: () => {
              cancelAnimationFrame(frame)
              window.removeEventListener('resize', schedule)
            },
          }
        },
      }),
    ]
  },
})
