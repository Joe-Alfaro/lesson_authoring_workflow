// The editor's pacing ribbon and table, built from the section minutes (D-016: pacing isn't stored
// twice, R17). A widget before the first section, rebuilt only when what it shows changes.
import { Extension } from '@tiptap/core'
import type { Node as PmNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { docToLesson, parseData } from '../../editor/convert'
import { FRONT_MATTER_NODE, SECTION_NODE } from '../../editor/schema'
import type { Section } from '../../lesson/schema'
import { minutesLabel, routineName, SECTION_COLOURS, SECTION_NAMES } from '../../lesson/labels'

interface PacingRow {
  kind: Section['kind']
  minutes: number
  purpose: string
  parts: { label?: string; title?: string; standards: string[]; minutes?: number }[]
  routines: string[]
}

interface Pacing {
  rows: PacingRow[]
  duration: number
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (text !== undefined) element.textContent = text
  return element
}

/** Reads the pacing straight from the doc (it must show even while a field is mid-edit). */
function pacingOf(doc: PmNode): Pacing {
  const json = doc.toJSON()
  const result = docToLesson(json)
  let duration = 0
  const rows: PacingRow[] = []
  doc.descendants((node) => {
    if (node.type.name === FRONT_MATTER_NODE) {
      duration = Number(parseData(node.toJSON()).durationMinutes ?? 0)
      return false
    }
    if (node.type.name === SECTION_NODE) {
      const data = parseData(node.toJSON())
      rows.push({
        kind: data.kind as Section['kind'],
        minutes: Number(data.minutes ?? 0),
        purpose: '',
        parts: [],
        routines: [],
      })
      return false
    }
    return true
  })
  if (result.ok) {
    result.lesson.body.sections.forEach((section, index) => {
      const row = rows[index]
      if (!row) return
      row.purpose = section.purpose.replace(/\*/g, '')
      row.parts = section.parts.filter((part) => part.label || part.title)
      row.routines = section.parts
        .flatMap((part) => part.blocks)
        .flatMap((block) =>
          block.type === 'routine' ? [block.label ?? routineName(block.routine)] : [],
        )
    })
  }
  return { rows, duration }
}

function render(pacing: Pacing): HTMLElement {
  const dom = el('div', 'pacing')
  dom.id = 'pacing'
  dom.contentEditable = 'false'
  dom.append(el('h2', 'dh', 'Lesson pacing'))
  const ribbon = el('div', 'ribbon pace-ribbon')
  ribbon.setAttribute('role', 'img')
  ribbon.setAttribute(
    'aria-label',
    `Pacing: ${pacing.rows.map((row) => `${SECTION_NAMES[row.kind]} ${row.minutes}`).join(', ')} minutes`,
  )
  pacing.rows.forEach((row) => {
    const segment = el('i', SECTION_COLOURS[row.kind])
    segment.style.flex = String(row.minutes)
    ribbon.append(segment)
  })
  dom.append(ribbon)

  const table = el('table', 'pace')
  const head = el('thead')
  const headRow = el('tr')
  ;['Lesson flow', 'Purpose of learning experience'].forEach((text) => {
    const th = el('th', undefined, text)
    th.scope = 'col'
    headRow.append(th)
  })
  head.append(headRow)
  const body = el('tbody')
  pacing.rows.forEach((row) => {
    const tr = el('tr')
    const flow = el('td')
    flow.append(el('span', `sw ${SECTION_COLOURS[row.kind]}`))
    flow.append(document.createTextNode(`${SECTION_NAMES[row.kind]}, ${minutesLabel(row.minutes)}`))
    const purpose = el('td', undefined, row.purpose)
    if (row.kind === 'learning_in_action') {
      row.parts.forEach((part) => {
        const line = el('div')
        line.append(
          el(
            'b',
            undefined,
            [part.label ? `Part ${part.label}` : null, part.title].filter(Boolean).join(': '),
          ),
        )
        const codes = part.standards.length > 0 ? ` (${part.standards.join(', ')})` : ''
        line.append(
          document.createTextNode(
            `${codes}${part.minutes ? `, ${minutesLabel(part.minutes)}` : ''}`,
          ),
        )
        purpose.append(line)
      })
    }
    if (row.routines.length > 0) purpose.append(el('div', 'caption', row.routines.join(', ')))
    tr.append(flow, purpose)
    body.append(tr)
  })
  table.append(head, body)
  dom.append(table)
  const total = pacing.rows.reduce((sum, row) => sum + row.minutes, 0)
  dom.append(
    el(
      'p',
      'pace derived',
      `Built from the section minutes below. Total ${total} of ${pacing.duration} minutes.`,
    ),
  )
  return dom
}

function decorations(doc: PmNode): DecorationSet {
  let at: number | null = null
  doc.descendants((node, pos) => {
    if (at !== null) return false
    if (node.type.name === SECTION_NODE) {
      at = pos
      return false
    }
    return true
  })
  if (at === null) return DecorationSet.empty
  const pacing = pacingOf(doc)
  return DecorationSet.create(doc, [
    Decoration.widget(at, () => render(pacing), {
      side: -1,
      ignoreSelection: true,
      key: `pacing:${JSON.stringify(pacing)}`,
    }),
  ])
}

export const PacingWidget = Extension.create({
  name: 'lessonPacing',
  addProseMirrorPlugins() {
    const key = new PluginKey<DecorationSet>('lessonPacing')
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_, state) => decorations(state.doc),
          apply: (tr, old, _oldState, state) => (tr.docChanged ? decorations(state.doc) : old),
        },
        props: { decorations: (state) => key.getState(state) },
      }),
    ]
  },
})
