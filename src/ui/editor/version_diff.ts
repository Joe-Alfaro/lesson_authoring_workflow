// R14 version preview: each text field that differs from the current lesson shows the version's
// text highlighted ("Text in this version") with the current text struck through before it
// ("Current text"). Fields are matched by the nearest id (section, part, block) plus the path of
// field keys below it, so moved or edited neighbours don't shift the comparison. Browser only.
import { Extension } from '@tiptap/core'
import type { Node as PmNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { FIELD_TEXT_NODE } from '../../editor/schema'

interface Field {
  pos: number
  node: PmNode
  text: string
}

/** Every text field of a lesson doc by a stable key. */
export function fieldTexts(doc: PmNode): Map<string, Field> {
  const fields = new Map<string, Field>()
  function walk(node: PmNode, pos: number, key: string) {
    node.forEach((child, offset, index) => {
      const childPos = pos + offset
      const id = child.attrs.id
      const childKey =
        typeof id === 'string' && id
          ? `#${id}`
          : `${key}/${typeof child.attrs.key === 'string' ? child.attrs.key : child.type.name}[${index}]`
      if (child.type.name === FIELD_TEXT_NODE) {
        fields.set(childKey, { pos: childPos, node: child, text: child.textContent })
        return
      }
      if (!child.isLeaf) walk(child, childPos + 1, childKey)
    })
  }
  walk(doc, 0, '')
  return fields
}

function currentTextWidget(text: string): HTMLElement {
  const old = document.createElement('span')
  old.className = 'del diff-current'
  old.setAttribute('role', 'group')
  old.setAttribute('aria-label', 'Current text')
  old.textContent = text
  const wrap = document.createElement('span')
  wrap.append(old, document.createTextNode(' '))
  return wrap
}

/** Decorates the preview with its differences from `current` (field key -> text). */
export function VersionDiff(current: Map<string, string>) {
  return Extension.create({
    name: 'lessonVersionDiff',
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: new PluginKey('lessonVersionDiff'),
          state: {
            init: (_config, state) => {
              const decos: Decoration[] = []
              fieldTexts(state.doc).forEach((field, key) => {
                const now = current.get(key)
                if (now === field.text) return
                decos.push(
                  Decoration.node(field.pos, field.pos + field.node.nodeSize, {
                    class: 'diff-field',
                    role: 'group',
                    'aria-label': 'Text in this version',
                  }),
                )
                if (now) {
                  decos.push(
                    Decoration.widget(field.pos + 1, () => currentTextWidget(now), {
                      side: -1,
                      key: `diff-${key}`,
                    }),
                  )
                }
              })
              return DecorationSet.create(state.doc, decos)
            },
            apply: (tr, set) => set.map(tr.mapping, tr.doc),
          },
          props: {
            decorations(state) {
              return this.getState(state)
            },
          },
        }),
      ]
    },
  })
}
