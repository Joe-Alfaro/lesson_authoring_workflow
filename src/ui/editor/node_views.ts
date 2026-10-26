// Plain DOM node views that lay the lesson out like the approved editor mockup (R17-lesson-editor):
// gutter labels, boxed blocks, section headings, standard chips. Labels and controls are
// contenteditable=false; only field text is editable. Browser only.
import type { Editor, NodeViewRendererProps } from '@tiptap/core'
import type { Node as PmNode } from '@tiptap/pm/model'
import type { NodeView } from '@tiptap/pm/view'
import { parseData } from '../../editor/convert'
import {
  blockNodeName,
  blockTypeOf,
  BODY_NODE,
  FIELD_GROUP_NODE,
  FIELD_LIST_NODE,
  FIELD_TEXT_NODE,
  FRONT_MATTER_NODE,
  PART_NODE,
  SECTION_NODE,
  STANDARD_CHIP_NODE,
  STANDARD_GROUP_NODE,
  type LessonNodeViews,
} from '../../editor/schema'
import type { StandardGroup } from '../../editor/standards'
import { BLOCK_TYPES, type Block, type Section } from '../../lesson/schema'
import {
  LESSON_TYPE_NAMES,
  minutesLabel,
  routineName,
  SECTION_COLOURS,
  SECTION_NAMES,
  sectionAnchor,
} from '../../lesson/labels'
import { iconSvg, type IconName } from '../lesson/lesson_icons'
import { bindStandardChip, isKnownStandard } from '../lesson/standard_tooltip'

/** What the views need from the page; a mutable object so callbacks stay current. */
export interface EditorViewContext {
  editable: boolean
  unitNumber: number
  lessonLabel: string
  addStandard(group: StandardGroup, anchor: HTMLElement): void
  removeStandard(group: StandardGroup, code: string): void
  addPart(sectionId: string): void
  removePart(partId: string): void
  addBlock(afterBlockId: string, type: Block['type']): void
  removeBlock(blockId: string): void
  /** R21: present only when this user may use AI assist on this lesson. */
  regenerateSection?: (sectionId: string, kind: Section['kind']) => void
}

type Json = Record<string, unknown>

/** Block types a reviewer adds from the "Add a block" menu (R17: prompts and teacher text). */
export const ADDABLE_BLOCKS: { type: Block['type']; label: string }[] = [
  { type: 'say', label: 'Say' },
  { type: 'ask', label: 'Ask with exemplar' },
  { type: 'directions', label: 'Directions' },
  { type: 'paragraph', label: 'Teacher note' },
  { type: 'teacher_tip', label: 'Teacher tip' },
  { type: 'sentence_starter', label: 'Sentence starter' },
  { type: 'display', label: 'Display' },
  { type: 'list', label: 'List' },
]

const BLOCK_NAMES: Partial<Record<Block['type'], string>> = {
  paragraph: 'teacher note',
  say: 'Say',
  ask: 'Ask',
  directions: 'Directions',
  connection: 'Connection',
  display: 'Display',
  list: 'list',
  table: 'table',
  teacher_tip: 'teacher tip',
  sentence_starter: 'sentence starter',
  routine: 'routine',
  teach: 'teach heading',
}

const STANDARD_GROUP_LABELS: Record<StandardGroup, { term: string; add: string }> = {
  focusStandards: { term: 'Focus standards', add: 'Add focus standard' },
  supportingStandards: { term: 'Supporting standards', add: 'Add supporting standard' },
  eldStandards: { term: 'ELD standards', add: 'Add ELD standard' },
}

const OPTION_LETTERS = ['A', 'B', 'C', 'D']

// ---------- DOM helpers ----------

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (text !== undefined) element.textContent = text
  return element
}

/** A non-editable element (labels, headings, controls). */
function fixed<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = h(tag, className, text)
  element.contentEditable = 'false'
  return element
}

function icon(name: IconName): Element {
  const holder = document.createElement('span')
  holder.innerHTML = iconSvg(name)
  return holder.firstElementChild!
}

function button(className: string, label: string, onClick: () => void): HTMLButtonElement {
  const element = h('button', className)
  element.type = 'button'
  element.contentEditable = 'false'
  element.textContent = label
  element.addEventListener('mousedown', (event) => event.preventDefault())
  element.addEventListener('click', (event) => {
    event.preventDefault()
    onClick()
  })
  return element
}

// ---------- context ----------

interface Where {
  /** Ancestors from the parent outwards. */
  ancestors: PmNode[]
  index: number
  blockType: Block['type'] | null
  sectionKind: Section['kind'] | null
}

function locate(editor: Editor, getPos: NodeViewRendererProps['getPos']): Where {
  const pos = typeof getPos === 'function' ? getPos() : undefined
  if (pos === undefined) return { ancestors: [], index: 0, blockType: null, sectionKind: null }
  const $pos = editor.state.doc.resolve(pos)
  const ancestors = Array.from({ length: $pos.depth + 1 }, (_, i) => $pos.node($pos.depth - i))
  const block = ancestors.find((node) => blockTypeOf(node.type.name) !== null)
  const section = ancestors.find((node) => node.type.name === SECTION_NODE)
  return {
    ancestors,
    index: $pos.index(),
    blockType: block ? blockTypeOf(block.type.name) : null,
    sectionKind: section ? (parseData(section.toJSON()).kind as Section['kind']) : null,
  }
}

function keyOf(node: PmNode | undefined): string | null {
  const key = node?.attrs.key
  return typeof key === 'string' ? key : null
}

function dataOf(node: PmNode): Json {
  return parseData(node.toJSON())
}

/** Node view basics: ignore DOM changes outside the editable part, let buttons handle events. */
function view(dom: HTMLElement, contentDOM: HTMLElement | null, original: PmNode): NodeView {
  return {
    dom,
    contentDOM: contentDOM ?? undefined,
    update: (node) =>
      node.type === original.type &&
      node.attrs.data === original.attrs.data &&
      node.attrs.key === original.attrs.key &&
      node.attrs.code === original.attrs.code,
    ignoreMutation: (mutation) =>
      mutation.type !== 'selection' && !(contentDOM?.contains(mutation.target) ?? false),
    stopEvent: (event) =>
      event.target instanceof Element &&
      event.target.closest('button, input, [data-control]') !== null,
  }
}

function gutter(label: string, className = ''): { dom: HTMLElement; content: HTMLElement } {
  const dom = h('div', `blk ${className}`)
  dom.append(fixed('div', 'g', label))
  const content = h('div', 'c')
  dom.append(content)
  return { dom, content }
}

function boxTitle(iconName: IconName, title: string): HTMLElement {
  const bt = fixed('div', 'bt')
  bt.append(icon(iconName), document.createTextNode(title))
  return bt
}

function codesNote(codes: unknown): string {
  return Array.isArray(codes) && codes.length > 0 ? ` (${codes.join(', ')})` : ''
}

// ---------- field_text ----------

/** Gutter labels of one-text blocks and keyed block fields. */
const GUTTERS: Record<string, { label: string; className?: string }> = {
  'paragraph.text': { label: 'Teacher', className: 'teacher' },
  'say.text': { label: 'Say', className: 'say' },
  'directions.text': { label: 'Directions', className: 'dir' },
  'connection.text': { label: 'Connection' },
  'sentence_starter.text': { label: 'Starter' },
  'ask.question': { label: 'Ask', className: 'ask' },
  'ask.exemplar': { label: 'Exemplar', className: 'ex' },
  'display.label': { label: 'Display', className: 'disp-label' },
  'display.text': { label: '', className: 'disp-text' },
  'list.intro': { label: '', className: 'list-intro' },
}

const PREFIXES: Record<string, string> = {
  'objectives.content': 'Content.',
  'objectives.language': 'Language.',
  'objectives.foundationalSkills': 'Foundational skills.',
  'leveledFrames.emerging': 'Emerging:',
  'leveledFrames.expanding': 'Expanding:',
  'leveledFrames.bridging': 'Bridging:',
  'recasts.studentSaid': 'Student says:',
  'recasts.academic': 'Recast:',
  'watchFor.trigger': 'If',
  'watchFor.prompt': '→ Prompt:',
}

const TERMS: Record<string, string> = {
  'connections.knowledgeBuilding': 'Knowledge-building',
  'connections.enduringUnderstanding': 'Enduring understanding',
  'connections.futureLessons': 'Future lessons',
  'connections.unitPerformanceTask': 'Unit performance task',
}

const ELD_HEADINGS: Record<string, string> = {
  purpose: 'Purpose',
  beforeActivity: 'Before the activity',
}

function prefixed(tag: 'li' | 'div', prefix: string, className = ''): NodeViewParts {
  const dom = h(tag, className)
  dom.append(fixed('b', 'pre', `${prefix} `))
  const content = h('span', 'field')
  dom.append(content)
  return { dom, content }
}

interface NodeViewParts {
  dom: HTMLElement
  content: HTMLElement
}

function fieldText(node: PmNode, where: Where, ctx: EditorViewContext): NodeViewParts {
  const key = keyOf(node)
  const parent = where.ancestors[0]
  const parentName = parent?.type.name
  const parentKey = keyOf(parent)
  const grandKey = keyOf(where.ancestors[1])

  if (parentName === BODY_NODE && key === 'title') {
    const dom = h('div', 'title-field')
    const frontMatter = parent ? findChild(parent, FRONT_MATTER_NODE) : null
    const unitTitle = frontMatter ? String(dataOf(frontMatter).unitTitle ?? '') : ''
    dom.append(fixed('div', 'kicker', `Unit ${ctx.unitNumber}: ${unitTitle}`))
    const heading = h('h1', 'lt')
    heading.append(fixed('span', 'pre', `${ctx.lessonLabel}: `))
    const content = h('span', 'field')
    heading.append(content)
    dom.append(heading)
    return { dom, content }
  }

  if (parentName === FIELD_LIST_NODE) {
    const listKey = parentKey
    // Table cells: rows > row > cell.
    if (where.blockType === 'table' && (listKey === 'headers' || grandKey === 'rows')) {
      const content = h('div', listKey === 'headers' ? 'tcell th' : 'tcell')
      return { dom: content, content }
    }
    if (listKey === 'languageFocus' || listKey === 'levels') {
      const content = h('li', 'chip sm word')
      return { dom: content, content }
    }
    const content = h('li')
    return { dom: content, content }
  }

  if (parentName === FIELD_GROUP_NODE) {
    const groupKey = parentKey ?? grandKey ?? ''
    const prefix = PREFIXES[`${groupKey}.${key}`]
    if (prefix) return prefixed(groupKey === 'objectives' ? 'li' : 'div', prefix, 'pf')
    const term = TERMS[`${groupKey}.${key}`]
    if (term) {
      const dom = h('div', 'fm-row')
      dom.append(fixed('div', 'fm-t', term))
      const content = h('div', 'fm-d prose')
      dom.append(content)
      return { dom, content }
    }
    if (where.blockType === 'pulse_check' && key === 'text') {
      const content = h('div', 'prose opt-text')
      return { dom: content, content }
    }
    if (where.blockType === 'pulse_check' && key === 'rationale') {
      const option = parent ? dataOf(parent) : {}
      return prefixed('div', option.correct ? 'Correct:' : 'Incorrect:', 'why')
    }
    if (where.blockType === 'student_support' && key === 'focus') {
      const row = parent ? dataOf(parent) : {}
      return prefixed(
        'div',
        row.kind === 'extension' ? 'Ready for extension:' : 'Struggling with:',
        'tcell first',
      )
    }
    if (where.blockType === 'student_support' && key === 'tryThis') {
      const content = h('div', 'tcell')
      return { dom: content, content }
    }
    if (where.blockType === 'rubric' && key === 'name') {
      const content = h('div', 'crit-name')
      return { dom: content, content }
    }
    if (
      groupKey === 'addressed' ||
      groupKey === 'support' ||
      key === 'term' ||
      key === 'definition'
    ) {
      const content = h('span', key === 'term' ? 'term' : 'def')
      return { dom: content, content }
    }
    if (groupKey === 'homework' && key === 'intro') {
      const { dom, content } = gutter('Teacher', 'teacher')
      return { dom, content }
    }
    if (groupKey === 'homework' && key === 'teacherTip') {
      const dom = h('div', 'box')
      dom.append(boxTitle('info', 'Teacher tip'))
      const content = h('div', 'prose')
      dom.append(content)
      return { dom, content }
    }
    const content = h('div', 'prose')
    return { dom: content, content }
  }

  if (parentName === SECTION_NODE && key === 'purpose') {
    const { dom, content } = gutter('Purpose', 'purpose')
    return { dom, content }
  }

  if (parentName === PART_NODE) {
    const inAction = where.sectionKind === 'learning_in_action'
    if (key === 'label') {
      const dom = h(inAction ? 'h3' : 'h4', inAction ? 'part-h part-label' : 'routine')
      if (inAction) dom.append(fixed('span', 'pre', 'Part\u00a0'))
      const content = h('span', 'field')
      dom.append(content)
      if (inAction) dom.append(fixed('span', 'pre', ':'))
      return { dom, content }
    }
    if (key === 'title') {
      const dom = h(inAction ? 'h3' : 'div', inAction ? 'part-h part-title' : 'part-sub')
      const content = h('span', 'field')
      dom.append(content)
      if (inAction && parent) {
        const part = dataOf(parent)
        const meta = fixed('span', 'part-meta')
        ;((part.standards as string[] | undefined) ?? []).forEach((code) =>
          meta.append(h('span', 'chip sm', code)),
        )
        if (typeof part.minutes === 'number') {
          meta.append(h('span', 'caption part-min', minutesLabel(part.minutes)))
        }
        dom.append(meta)
      }
      return { dom, content }
    }
    const { dom, content } = gutter('Purpose', 'purpose')
    return { dom, content }
  }

  const blockType = where.blockType
  if (blockType) {
    const gutterSpec = GUTTERS[`${blockType}.${key}`]
    if (gutterSpec) {
      const { dom, content } = gutter(gutterSpec.label, gutterSpec.className)
      if (blockType === 'display' && key === 'text') content.classList.add('disp')
      return { dom, content }
    }
    if (blockType === 'routine' || blockType === 'teach') {
      const content = h('h4', 'routine')
      return { dom: content, content }
    }
    if (blockType === 'student_support' && key === 'title') {
      const content = h('span', 'field')
      return { dom: content, content }
    }
    if (blockType === 'rubric' && key === 'title') {
      const content = h('div', 'rubric-title')
      return { dom: content, content }
    }
    if (blockType === 'eld_instructions' && key && ELD_HEADINGS[key]) {
      const dom = h('div', 'eld-field')
      dom.append(fixed('h5', undefined, ELD_HEADINGS[key]))
      const content = h('div', 'prose')
      dom.append(content)
      return { dom, content }
    }
  }
  const content = h('div', 'prose')
  return { dom: content, content }
}

function findChild(node: PmNode, typeName: string): PmNode | null {
  let found: PmNode | null = null
  node.forEach((child) => {
    if (!found && child.type.name === typeName) found = child
  })
  return found
}

// ---------- field_list and field_group ----------

const LIST_HEADINGS: Record<string, string> = {
  'eld_instructions.languageFocus': 'Language focus',
  'eld_instructions.moves': 'Say and ask',
  'eld_instructions.recasts': 'Recasts',
  'eld_instructions.frames': 'Frames',
  'eld_instructions.assetMoves': 'Asset moves',
  'eld_instructions.watchFor': 'Watch for and support if needed',
  'eld_instructions.successCriteria': 'Success criteria',
  'check_for_understanding.lookFors': 'Look for',
  'rubric.levels': 'Levels',
  'rubric.criteria': 'Criteria',
  'rubric.descriptors': '',
}

function fieldList(node: PmNode, where: Where): NodeViewParts {
  const key = keyOf(node)
  const parent = where.ancestors[0]
  const parentName = parent?.type.name

  if (parentName === BODY_NODE && key === 'essentialQuestions') {
    const dom = h('div', 'eq')
    dom.append(fixed('h2', 'dh', 'Essential questions'))
    const content = h('ul', 'prose')
    dom.append(content)
    return { dom, content }
  }
  if (parentName === BODY_NODE && key === 'materials') {
    const dom = h('div', 'fm fm-more')
    dom.append(fixed('div', 'fm-t', 'Materials'))
    const content = h('ul', 'fm-d inline-list')
    dom.append(content)
    return { dom, content }
  }
  if (key === 'addressed' || key === 'support') {
    const dom = h('div', `vocab vocab-${key}`)
    if (key === 'support') dom.append(fixed('span', 'caption', 'For additional support: '))
    const content = h('span', 'vocab-list')
    dom.append(content)
    return { dom, content }
  }
  if (where.blockType === 'table') {
    if (key === 'headers') {
      const content = h('div', 'trow thead')
      content.style.setProperty('--cols', String(node.childCount))
      return { dom: content, content }
    }
    if (key === 'rows') {
      const content = h('div', 'tbody')
      return { dom: content, content }
    }
    const content = h('div', 'trow')
    content.style.setProperty('--cols', String(node.childCount))
    return { dom: content, content }
  }
  if (where.blockType === 'student_support' && key === 'rows') {
    const dom = h('div', 'supp-grid')
    const head = fixed('div', 'trow thead')
    head.append(h('div', 'tcell th', 'Situation'), h('div', 'tcell th', 'Try this'))
    dom.append(head)
    const content = h('div', 'tbody')
    dom.append(content)
    return { dom, content }
  }
  if (where.blockType === 'pulse_check' && key === 'options') {
    const content = h('ul', 'opts')
    return { dom: content, content }
  }

  const heading = where.blockType ? LIST_HEADINGS[`${where.blockType}.${key}`] : undefined
  const homework = keyOf(parent) === 'homework'
  const itemsAreText = firstChildName(node) !== FIELD_GROUP_NODE
  const ordered = where.blockType === 'list' && Boolean(parent && dataOf(parent).ordered)
  const dom = h('div', `flist${homework ? ' blk' : ''}`)
  if (homework) dom.append(fixed('div', 'g', ''))
  if (heading) dom.append(fixed('h5', undefined, heading))
  const content = itemsAreText
    ? h(ordered ? 'ol' : 'ul', key === 'languageFocus' || key === 'levels' ? 'chips' : 'prose')
    : h('div', 'groups')
  dom.append(content)
  if (homework) content.classList.add('c')
  return { dom, content }
}

function firstChildName(node: PmNode): string | null {
  return node.firstChild?.type.name ?? null
}

function fieldGroup(node: PmNode, where: Where): NodeViewParts {
  const key = keyOf(node)
  const parent = where.ancestors[0]
  const parentName = parent?.type.name

  if (parentName === BODY_NODE) {
    if (key === 'objectives') {
      const dom = h('div', 'objectives')
      dom.id = 'objectives'
      dom.append(fixed('h2', 'dh', 'Student learning objectives'))
      const content = h('ol', 'prose obj')
      dom.append(content)
      return { dom, content }
    }
    if (key === 'connections') {
      const dom = h('div', 'connections')
      dom.append(fixed('h2', 'dh', 'Connections'))
      const content = h('div', 'fm conn')
      dom.append(content)
      return { dom, content }
    }
    if (key === 'vocabulary') {
      const dom = h('div', 'fm fm-more')
      dom.append(fixed('div', 'fm-t', 'Vocabulary'))
      const content = h('div', 'fm-d')
      dom.append(content)
      return { dom, content }
    }
    if (key === 'homework') {
      const dom = h('section', 'sec homework')
      dom.id = sectionAnchor('homework')
      const head = fixed('div', 'sec-h')
      head.append(h('h2', undefined, 'Homework'))
      dom.append(head)
      const content = h('div', 'sec-body')
      dom.append(content)
      return { dom, content }
    }
  }

  if (where.blockType === 'pulse_check') {
    const option = dataOf(node)
    const letter = OPTION_LETTERS[where.index] ?? String(where.index + 1)
    const dom = h('li', option.correct ? 'correct' : '')
    const mark = fixed('span', 'L', letter)
    mark.setAttribute('role', 'img')
    mark.setAttribute('aria-label', `Option ${letter}${option.correct ? ', correct' : ''}`)
    dom.append(mark)
    const content = h('div')
    dom.append(content)
    return { dom, content }
  }
  if (where.blockType === 'student_support') {
    const content = h('div', 'trow supp-row')
    return { dom: content, content }
  }
  if (key === 'leveledFrames') {
    const dom = h('div', 'eld-field')
    dom.append(fixed('h5', undefined, 'Leveled frames'))
    const content = h('div', 'prose')
    dom.append(content)
    return { dom, content }
  }
  if (where.blockType === 'rubric') {
    const criterion = dataOf(node)
    const dom = h('div', 'criterion')
    if (typeof criterion.standard === 'string') {
      dom.append(fixed('span', 'chip sm crit-std', criterion.standard))
    }
    const content = h('div')
    dom.append(content)
    return { dom, content }
  }
  const content = h('div', `group group-${keyOf(where.ancestors[0]) ?? key ?? ''}`)
  return { dom: content, content }
}

// ---------- blocks ----------

function blockView(node: PmNode, ctx: EditorViewContext): NodeViewParts {
  const type = blockTypeOf(node.type.name)!
  const data = dataOf(node)
  const id = String(node.attrs.id)
  let dom: HTMLElement
  let content: HTMLElement

  const boxed = (iconName: IconName, title: string, className = '') => {
    dom = h('div', `box ${className}`)
    dom.append(boxTitle(iconName, title))
    content = h('div', 'box-body')
    dom.append(content)
  }

  switch (type) {
    case 'teacher_tip':
      boxed('info', 'Teacher tip')
      break
    case 'pulse_check':
      boxed('check', `Pulse check${codesNote(data.standards)}`)
      break
    case 'check_for_understanding':
      boxed('target', `Check for understanding${codesNote(data.standards)}`)
      break
    case 'reflection':
      boxed('target', `Reflection${codesNote(data.standards)}`)
      break
    case 'rubric':
      boxed('target', 'Rubric')
      break
    case 'eld_instructions':
    case 'student_support': {
      dom = h('div', 'box collapsible')
      const title = fixed('div', 'bt')
      const toggle = button('box-toggle', '', () => {
        const open = dom.classList.toggle('closed') === false
        toggle.setAttribute('aria-expanded', String(open))
        toggle.replaceChildren(icon(open ? 'chevronDown' : 'chevronRight'), label)
      })
      const label = document.createTextNode(
        type === 'eld_instructions' ? 'Integrated ELD instructions' : '',
      )
      toggle.setAttribute('aria-expanded', 'true')
      toggle.append(icon('chevronDown'), label)
      title.append(toggle)
      dom.append(title)
      content = h('div', 'box-body')
      if (type === 'student_support') {
        // The (editable) title sits in the title row; with none, the default title.
        const hasTitle = findChildByKey(node, 'title') !== null
        label.textContent = hasTitle ? '' : 'Additional student support'
        if (hasTitle) toggle.setAttribute('aria-label', 'Show or hide additional student support')
        content.classList.add('supp-body')
      }
      if (type === 'eld_instructions') content.classList.add('eld-grid')
      dom.append(content)
      break
    }
    case 'routine': {
      dom = h('div', 'routine-blk')
      if (findChildByKey(node, 'label') === null) {
        dom.append(fixed('h4', 'routine', routineName(String(data.routine ?? 'other'))))
      }
      content = h('div')
      dom.append(content)
      break
    }
    case 'teach': {
      dom = h('div', 'teach-blk')
      if (findChildByKey(node, 'title') === null) dom.append(fixed('h4', 'routine', 'Teach'))
      content = h('div')
      dom.append(content)
      break
    }
    case 'list': {
      dom = h('div', 'blk-list')
      content = h('div', 'blk-list-body')
      dom.append(content)
      break
    }
    case 'table': {
      dom = h('div', 'lesson-grid')
      content = h('div')
      dom.append(content)
      break
    }
    default: {
      dom = h('div', `blk-wrap ${type}`)
      content = h('div')
      dom.append(content)
    }
  }

  dom!.classList.add('lesson-block')
  dom!.dataset.blockId = id
  if (ctx.editable && BLOCK_NAMES[type]) {
    const remove = button('blk-remove', '×', () => ctx.removeBlock(id))
    remove.setAttribute('aria-label', `Remove ${BLOCK_NAMES[type]} block`)
    remove.title = 'Remove block'
    dom!.append(remove)
  }
  return { dom: dom!, content: content! }
}

function findChildByKey(node: PmNode, key: string): PmNode | null {
  let found: PmNode | null = null
  node.forEach((child) => {
    if (!found && child.attrs.key === key) found = child
  })
  return found
}

// ---------- sections and parts ----------

function sectionView(node: PmNode, where: Where, ctx: EditorViewContext): NodeViewParts {
  const data = dataOf(node)
  const kind = data.kind as Section['kind']
  const parent = where.ancestors[0]
  let number = 0
  parent?.forEach((child, _offset, index) => {
    if (index <= where.index && child.type.name === SECTION_NODE) number += 1
  })
  const dom = h('section', `sec ${SECTION_COLOURS[kind] ?? ''}`)
  dom.id = sectionAnchor(kind)
  const head = fixed('div', 'sec-h')
  head.append(
    h('span', 'no', String(number)),
    h('h2', undefined, SECTION_NAMES[kind] ?? kind),
    h('span', 'mins', minutesLabel(Number(data.minutes ?? 0))),
  )
  const regenerate = ctx.regenerateSection
  if (ctx.editable && regenerate) {
    const sectionId = String(node.attrs.id)
    const ai = button('btn quiet sm sec-regen', '', () => regenerate(sectionId, kind))
    ai.append(icon('sparkle'), document.createTextNode('Regenerate'))
    ai.setAttribute('aria-label', `Regenerate ${SECTION_NAMES[kind] ?? kind} with AI`)
    head.append(ai)
  }
  dom.dataset.sectionId = String(node.attrs.id)
  dom.append(head)
  const content = h('div', 'sec-body')
  dom.append(content)
  if (ctx.editable && kind === 'learning_in_action') {
    const add = button('add-blk add-part', '', () => ctx.addPart(String(node.attrs.id)))
    const plus = h('span', 'plus')
    plus.append(icon('plus'))
    add.append(plus, document.createTextNode('Add a part'))
    dom.append(add)
  }
  return { dom, content }
}

function partView(node: PmNode, where: Where, ctx: EditorViewContext): NodeViewParts {
  const dom = h('div', 'part')
  const id = String(node.attrs.id)
  dom.id = `part-${id}`
  const content = h('div', 'part-body')
  dom.append(content)
  if (!ctx.editable) return { dom, content }

  const tools = fixed('div', 'part-tools')
  const add = button('add-blk', '', () => toggleMenu())
  const plus = h('span', 'plus')
  plus.append(icon('plus'))
  add.append(plus, document.createTextNode('Add a block'))
  add.setAttribute('aria-haspopup', 'menu')
  add.setAttribute('aria-expanded', 'false')
  const menu = h('div', 'float menu block-menu')
  menu.setAttribute('role', 'menu')
  ADDABLE_BLOCKS.forEach((option) => {
    const item = button('mi', option.label, () => {
      toggleMenu(false)
      let lastBlock: string | null = null
      node.forEach((child) => {
        if (blockTypeOf(child.type.name)) lastBlock = String(child.attrs.id)
      })
      if (lastBlock) ctx.addBlock(lastBlock, option.type)
    })
    item.setAttribute('role', 'menuitem')
    menu.append(item)
  })
  menu.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      toggleMenu(false)
      add.focus()
    }
  })
  // The menu is in the DOM only while open.
  function toggleMenu(open = !menu.isConnected) {
    if (open) tools.append(menu)
    else menu.remove()
    add.setAttribute('aria-expanded', String(open))
    if (open) (menu.querySelector('button') as HTMLButtonElement | null)?.focus()
  }
  tools.append(add)

  const section = where.ancestors[0]
  let parts = 0
  section?.forEach((child) => {
    if (child.type.name === PART_NODE) parts += 1
  })
  if (where.sectionKind === 'learning_in_action' && parts > 1) {
    const remove = button('btn quiet sm part-remove', 'Remove part', () => ctx.removePart(id))
    tools.append(remove)
  }
  dom.append(tools)
  return { dom, content }
}

// ---------- front matter and standards ----------

function frontMatterView(node: PmNode): NodeViewParts {
  const data = dataOf(node)
  const dom = h('div', 'front-matter')
  dom.id = 'front-matter'
  const meta = fixed('div', 'meta')
  meta.append(
    h('span', undefined, String(data.arc ?? '')),
    h('span', undefined, LESSON_TYPE_NAMES[data.type as keyof typeof LESSON_TYPE_NAMES] ?? ''),
    h('span', undefined, minutesLabel(Number(data.durationMinutes ?? 0))),
  )
  dom.append(meta)
  const grid = h('div', 'fm')
  const content = h('div', 'fm-groups')
  grid.append(content)
  const texts =
    (data.texts as { title: string; source?: string; pages?: string }[] | undefined) ?? []
  const textsTerm = fixed('div', 'fm-t', 'Lesson texts')
  const textsValue = fixed('div', 'fm-d')
  texts.forEach((text) => {
    const line = h('div')
    const title = h('b')
    title.append(h('i', undefined, text.title))
    line.append(title)
    line.append(
      document.createTextNode(
        `${text.source ? `, ${text.source}` : ''}${text.pages ? `. ${text.pages}` : ''}`,
      ),
    )
    textsValue.append(line)
  })
  grid.append(textsTerm, textsValue)
  dom.append(grid)
  return { dom, content }
}

function standardGroupView(node: PmNode, ctx: EditorViewContext): NodeViewParts {
  const group = String(node.attrs.key) as StandardGroup
  const labels = STANDARD_GROUP_LABELS[group]
  const dom = h('div', 'fm-row')
  dom.append(fixed('div', 'fm-t', labels?.term ?? group))
  const value = h('div', 'fm-d')
  const chips = h('div', 'chips')
  const content = h('span', 'chip-list')
  chips.append(content)
  if (ctx.editable && labels) {
    const add = button('chipadd', '', () => ctx.addStandard(group, add))
    add.append(icon('plus'), document.createTextNode('Add'))
    add.setAttribute('aria-label', labels.add)
    add.dataset.group = group
    chips.append(add)
  }
  value.append(chips)
  dom.append(value)
  return { dom, content }
}

function standardChipView(
  node: PmNode,
  where: Where,
  ctx: EditorViewContext,
): { dom: HTMLElement; destroy: () => void } {
  const code = String(node.attrs.code)
  const group = keyOf(where.ancestors[0]) as StandardGroup
  const dom = h('span', 'chip-wrap')
  const known = isKnownStandard(code)
  const chip = h('button', `chip chipbtn${known ? '' : ' warn'}`)
  chip.type = 'button'
  if (!known) chip.append(icon('warning'))
  chip.append(document.createTextNode(code))
  dom.append(chip)
  const unbind = bindStandardChip(chip, code)
  if (ctx.editable) {
    const remove = button('chip-x', '×', () => ctx.removeStandard(group, code))
    remove.setAttribute('aria-label', `Remove ${code}`)
    dom.append(remove)
  }
  return { dom, destroy: unbind }
}

// ---------- the view set ----------

/** Node views for every lesson node, reading page state from `ctx`. */
export function lessonNodeViews(ctx: EditorViewContext): LessonNodeViews {
  const make =
    (build: (node: PmNode, where: Where) => NodeViewParts) =>
    () =>
    ({ node, editor, getPos }: NodeViewRendererProps) => {
      const { dom, content } = build(node, locate(editor, getPos))
      return view(dom, content, node)
    }

  const views: LessonNodeViews = {
    [BODY_NODE]: make(() => {
      const content = h('div', 'lesson-body')
      return { dom: content, content }
    }),
    [FRONT_MATTER_NODE]: make((node) => frontMatterView(node)),
    [STANDARD_GROUP_NODE]: make((node) => standardGroupView(node, ctx)),
    [STANDARD_CHIP_NODE]:
      () =>
      ({ node, editor, getPos }: NodeViewRendererProps) => {
        const { dom, destroy } = standardChipView(node, locate(editor, getPos), ctx)
        return { ...view(dom, null, node), ignoreMutation: () => true, destroy }
      },
    [SECTION_NODE]: make((node, where) => sectionView(node, where, ctx)),
    [PART_NODE]: make((node, where) => partView(node, where, ctx)),
    [FIELD_TEXT_NODE]: make((node, where) => fieldText(node, where, ctx)),
    [FIELD_LIST_NODE]: make((node, where) => fieldList(node, where)),
    [FIELD_GROUP_NODE]: make((node, where) => fieldGroup(node, where)),
  }
  BLOCK_TYPES.forEach((type) => {
    views[blockNodeName(type)] = make((node) => blockView(node, ctx))
  })
  return views
}
