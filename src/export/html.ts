// R16 HTML export: one standalone file in the R19 teacher-facing layout (src/ui/lesson/lesson_view
// .tsx), built from string templates rather than react-dom/server, which Next rejects in the
// route-handler graph (src/export/README.md). Every piece of lesson text goes through esc() or
// rich(); nothing here emits scripts, external assets or event handlers.
import { parseInline } from '../editor/inline'
import {
  LESSON_TYPE_NAMES,
  lessonLabel,
  minutesLabel,
  partName,
  routineName,
  SECTION_COLOURS,
  SECTION_NAMES,
  sectionAnchor,
  unitKicker,
  type SectionKind,
} from '../lesson/labels'
import type { Block, LessonContent, Part, Section } from '../lesson/schema'
import { STATUS_LABELS } from '../workflow/transitions'
import type { ExportedLesson, ExportedStandard, LessonExport, UnitExport } from './types'

const OPTION_LETTERS = ['A', 'B', 'C', 'D']

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** Text and attribute values: every markup character becomes an entity. */
function esc(value: string | number): string {
  return String(value).replace(/[&<>"']/g, (char) => ESCAPES[char]!)
}

/** Lesson text with **bold** and *italic* as <strong> and <em> (D-016), the rest escaped. */
function rich(text: string): string {
  return parseInline(text)
    .map((node) => {
      const marks = new Set((node.marks ?? []).map((mark) => mark.type))
      const escaped = esc(node.text ?? '')
      const italic = marks.has('italic') ? `<em>${escaped}</em>` : escaped
      return marks.has('bold') ? `<strong>${italic}</strong>` : italic
    })
    .join('')
}

function join<T>(items: readonly T[], render: (item: T, index: number) => string): string {
  return items.map(render).join('')
}

/** "Lesson 4: Title" or "Flex day: Title", as markup. */
function lessonHeading(content: LessonContent): string {
  return `${esc(lessonLabel(content.frontMatter.number))}: ${rich(content.body.title)}`
}

/** "Lesson 4: Title" as plain text (the <title> and the contents links). */
function lessonHeadingText(content: LessonContent): string {
  const title = parseInline(content.body.title)
    .map((node) => node.text ?? '')
    .join('')
  return `${lessonLabel(content.frontMatter.number)}: ${title}`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

/** Ids of one lesson's anchors; in a unit file each lesson gets its own prefix. */
interface Anchors {
  section: (kind: SectionKind | 'homework') => string
}

function blk(label: string, body: string, className = ''): string {
  return `<div class="blk ${className}"><span class="g">${esc(label)}</span> <span class="c">${body}</span></div>`
}

function box(title: string, body: string, className = ''): string {
  return `<div class="box ${className}"><div class="bt">${title}</div>${body}</div>`
}

function prose(text: string): string {
  return `<div class="prose">${rich(text)}</div>`
}

function items(list: string[], ordered = false): string {
  const tag = ordered ? 'ol' : 'ul'
  return `<${tag}>${join(list, (item) => `<li>${rich(item)}</li>`)}</${tag}>`
}

function code(value: string): string {
  return `<span class="chip sm">${esc(value)}</span>`
}

/** "Pulse check (RL.6.1, L.6.4)". */
function titleWithCodes(title: string, codes: string[] | undefined): string {
  if (!codes || codes.length === 0) return esc(title)
  return `${esc(title)} (${codes.map(esc).join(', ')})`
}

function eldBox(block: Extract<Block, { type: 'eld_instructions' }>): string {
  const languageFocus =
    block.languageFocus && block.languageFocus.length > 0
      ? `<p class="caption">Language focus: ${block.languageFocus.map(rich).join(', ')}</p>`
      : ''
  const sayAndAsk = [
    ...(block.beforeActivity ? [rich(block.beforeActivity)] : []),
    ...block.moves.map(rich),
    ...(block.recasts ?? []).map(
      (recast) =>
        `Recast: You said “${rich(recast.studentSaid)}” We can say “${rich(recast.academic)}”`,
    ),
    ...block.frames.map((frame) => `Frame: ${rich(frame)}`),
    ...(block.assetMoves ?? []).map(rich),
  ]
  const leveled = block.leveledFrames
    ? `<ul><li>Emerging: ${rich(block.leveledFrames.emerging)}</li><li>Expanding: ${rich(block.leveledFrames.expanding)}</li><li>Bridging: ${rich(block.leveledFrames.bridging)}</li></ul>`
    : ''
  const watch = [
    ...block.watchFor.map((entry) => `If ${rich(entry.trigger)} → Prompt: ${rich(entry.prompt)}`),
    ...block.successCriteria.map((criterion) => `Success: ${rich(criterion)}`),
  ]
  const list = (lines: string[]) => `<ul>${join(lines, (line) => `<li>${line}</li>`)}</ul>`
  return box(
    'Integrated ELD instructions',
    `<h5>Purpose</h5>${prose(block.purpose)}${languageFocus}` +
      `<h5>Say and ask</h5>${list(sayAndAsk)}${leveled}` +
      `<h5>Watch for and support if needed</h5>${list(watch)}`,
    'eld',
  )
}

function table(caption: string, headers: string[], rows: string[][], className: string): string {
  return (
    `<table class="${className}">${caption ? `<caption>${caption}</caption>` : ''}` +
    `<thead><tr>${join(headers, (header) => `<th scope="col">${header}</th>`)}</tr></thead>` +
    `<tbody>${join(rows, (row) => `<tr>${join(row, (cell) => `<td>${cell}</td>`)}</tr>`)}</tbody></table>`
  )
}

function blockHtml(block: Block): string {
  switch (block.type) {
    case 'routine':
      return `<h4 class="routine">${block.label ? rich(block.label) : esc(routineName(block.routine))}</h4>`
    case 'teach':
      return `<h4 class="routine">${block.title ? rich(block.title) : 'Teach'}</h4>`
    case 'paragraph':
      return blk('Teacher', rich(block.text), 'teacher')
    case 'say':
      return blk('Say:', rich(block.text), 'say')
    case 'directions':
      return blk('Say these directions:', rich(block.text), 'dir')
    case 'ask':
      return (
        blk('Ask:', rich(block.question), 'ask') +
        blk('Exemplar response', rich(block.exemplar), 'ex')
      )
    case 'connection':
      return blk('Connection:', rich(block.text))
    case 'sentence_starter':
      return blk('Sentence starter:', rich(block.text))
    case 'display':
      return blk(
        block.label ? `Display (${block.label}):` : 'Display:',
        `<span class="disp">${rich(block.text)}</span>`,
      )
    case 'list':
      return `${block.intro ? `<p>${rich(block.intro)}</p>` : ''}${items(block.items, block.ordered)}`
    case 'table':
      return table(
        rich(block.caption),
        block.headers.map(rich),
        block.rows.map((row) => row.map(rich)),
        'supp',
      )
    case 'teacher_tip':
      return box('Teacher tip', prose(block.text), 'tip')
    case 'pulse_check':
      return box(
        titleWithCodes('Pulse check', block.standards),
        prose(block.stem) +
          `<ol class="opts">${join(block.options, (option, index) => {
            const letter = OPTION_LETTERS[index] ?? String(index + 1)
            return (
              `<li class="${option.correct ? 'correct' : ''}"><b>${letter}.</b> ${rich(option.text)}` +
              `<div class="why"><b>${option.correct ? 'Correct:' : 'Incorrect:'}</b> ${rich(option.rationale)}</div></li>`
            )
          })}</ol>`,
      )
    case 'check_for_understanding':
      return box(
        titleWithCodes('Check for understanding', block.standards),
        prose(block.prompt) +
          (block.lookFors && block.lookFors.length > 0
            ? `<h5>Look for</h5>${items(block.lookFors)}`
            : ''),
      )
    case 'reflection':
      return box(
        titleWithCodes('Reflection', block.standards),
        prose(block.prompt) + items(block.questions),
      )
    case 'eld_instructions':
      return eldBox(block)
    case 'student_support':
      return box(
        block.title ? rich(block.title) : 'Additional student support',
        table(
          '',
          ['Situation', 'Try this'],
          block.rows.map((row) => [
            `${row.kind === 'extension' ? 'Ready for extension' : 'Struggling with'}${row.focus ? `: ${rich(row.focus)}` : ''}`,
            rich(row.tryThis),
          ]),
          'supp',
        ),
      )
    case 'rubric':
      return box(
        rich(block.title),
        prose(block.prompt) +
          table(
            '',
            ['Criterion', ...block.levels.map(rich)],
            block.criteria.map((criterion) => [
              `${rich(criterion.name)}${criterion.standard ? ` ${code(criterion.standard)}` : ''}`,
              ...criterion.descriptors.map(rich),
            ]),
            'supp',
          ),
      )
  }
}

function partHeading(part: Part, inAction: boolean): string {
  if (!part.label && !part.title) return ''
  if (!inAction) {
    return `<h4 class="routine">${esc([part.label, part.title].filter(Boolean).join(': '))}</h4>`
  }
  return (
    `<h3 class="part-h">${rich(partName(part.label, part.title))}` +
    join(part.standards, (standard) => ` ${code(standard)}`) +
    (part.minutes ? ` <span class="caption">${esc(minutesLabel(part.minutes))}</span>` : '') +
    '</h3>'
  )
}

function sectionHtml(section: Section, index: number, anchors: Anchors): string {
  const inAction = section.kind === 'learning_in_action'
  return (
    `<section class="sec ${SECTION_COLOURS[section.kind]}" id="${esc(anchors.section(section.kind))}">` +
    `<div class="sec-h"><h2><span class="no">${index + 1}</span> ${esc(SECTION_NAMES[section.kind])}</h2>` +
    `<span class="mins">${esc(minutesLabel(section.minutes))}</span></div>` +
    join(
      section.parts,
      (part) =>
        `<div class="part">${partHeading(part, inAction)}${join(part.blocks, blockHtml)}</div>`,
    ) +
    '</section>'
  )
}

function routinesOf(section: Section): string {
  return section.parts
    .flatMap((part) => part.blocks)
    .flatMap((block) =>
      block.type === 'routine' ? [block.label ?? routineName(block.routine)] : [],
    )
    .join(', ')
}

/** The pacing table built from the section minutes (R19; D-016). */
function pacingTable(sections: Section[], duration: number): string {
  const total = sections.reduce((sum, section) => sum + section.minutes, 0)
  const rows = sections.map((section) => {
    const routines = routinesOf(section)
    const parts =
      section.kind === 'learning_in_action'
        ? section.parts
            .filter((part) => part.label || part.title)
            .map(
              (part) =>
                `<div><b>${rich(partName(part.label, part.title))}</b>` +
                (part.standards.length > 0 ? ` (${part.standards.map(esc).join(', ')})` : '') +
                (part.minutes ? `, ${esc(minutesLabel(part.minutes))}.` : '') +
                (part.purpose ? ` ${rich(part.purpose)}` : '') +
                '</div>',
            )
            .join('')
        : ''
    return (
      `<tr><td class="flow ${SECTION_COLOURS[section.kind]}">${esc(SECTION_NAMES[section.kind])}, ${esc(minutesLabel(section.minutes))}</td>` +
      `<td>${rich(section.purpose)}${parts}${routines ? `<div class="caption">${esc(routines)}</div>` : ''}</td></tr>`
    )
  })
  return (
    `<table class="pace"><thead><tr><th scope="col">Lesson flow</th><th scope="col">Purpose of learning experience</th></tr></thead>` +
    `<tbody>${rows.join('')}</tbody></table>` +
    `<p class="caption">Total ${total} of ${duration} minutes.</p>`
  )
}

function standardChips(codes: string[], known: Set<string>): string {
  if (codes.length === 0) return '<span class="caption">None</span>'
  return codes
    .map((value) =>
      known.has(value)
        ? code(value)
        : `<span class="chip sm warn" title="Not in the standards reference data">${esc(value)}</span>`,
    )
    .join(' ')
}

/** "Approved by <name> on <date>" or "Not approved: <status>" (README: Approval). */
function approvalNotice(lesson: ExportedLesson): string {
  if (!lesson.approved) {
    return `<p class="notice draft"><b>Not approved: ${esc(STATUS_LABELS[lesson.status])}</b>. This export is a working copy, not the handoff.</p>`
  }
  if (!lesson.approval) {
    return '<p class="notice ok"><b>Approved</b></p>'
  }
  return `<p class="notice ok"><b>Approved by ${esc(lesson.approval.by.name)}</b> on ${esc(formatDate(lesson.approval.at))}</p>`
}

/** The full text of each standard the lesson uses; a static file has no hover popover (R15). */
function standardsSection(standards: ExportedStandard[]): string {
  if (standards.length === 0) return ''
  return (
    '<section class="standards"><h2 class="dh">Standards</h2><dl class="fm std">' +
    join(standards, (standard) =>
      standard.text === null
        ? `<dt>${esc(standard.code)}</dt><dd class="caption">Not in the standards reference data.</dd>`
        : `<dt>${esc(standard.code)}</dt><dd>${esc(standard.text)}${standard.strand ? `<div class="caption">${esc(standard.strand)}</div>` : ''}</dd>`,
    ) +
    '</dl></section>'
  )
}

function lessonArticle(
  lesson: ExportedLesson,
  unitNumber: number,
  anchors: Anchors,
  id = '',
): string {
  const { frontMatter, body } = lesson.content
  const known = new Set(lesson.standards.filter((s) => s.text !== null).map((s) => s.code))
  const texts = join(
    frontMatter.texts,
    (text) =>
      `<div><b><i>${esc(text.title)}</i></b>${text.source ? `, ${esc(text.source)}` : ''}${text.pages ? `. ${esc(text.pages)}` : ''}</div>`,
  )
  const vocabularySupport =
    body.vocabulary.support.length > 0
      ? `<div class="caption">For additional support: ${esc(body.vocabulary.support.map((entry) => entry.term).join(', '))}</div>`
      : ''
  const homework = body.homework
    ? `<section class="sec homework" id="${esc(anchors.section('homework'))}"><div class="sec-h"><h2>Homework</h2></div>` +
      (body.homework.intro ? `<p>${rich(body.homework.intro)}</p>` : '') +
      items(body.homework.tasks) +
      (body.homework.teacherTip ? box('Teacher tip', prose(body.homework.teacherTip), 'tip') : '') +
      '</section>'
    : ''
  return (
    `<article class="doc"${id ? ` id="${esc(id)}"` : ''}>` +
    `<div class="kicker">${esc(unitKicker(unitNumber, frontMatter.unitTitle))}</div>` +
    `<h1>${lessonHeading(lesson.content)}</h1>` +
    `<div class="meta"><span>${esc(frontMatter.arc)}</span><span>${esc(LESSON_TYPE_NAMES[frontMatter.type])}</span><span>${esc(minutesLabel(frontMatter.durationMinutes))}</span></div>` +
    approvalNotice(lesson) +
    '<dl class="fm">' +
    `<dt>Focus standards</dt><dd>${standardChips(frontMatter.focusStandards, known)}</dd>` +
    `<dt>Supporting standards</dt><dd>${standardChips(frontMatter.supportingStandards, known)}</dd>` +
    `<dt>ELD standards</dt><dd>${standardChips(
      frontMatter.eldStandards.map((eld) => eld.code),
      known,
    )}</dd>` +
    `<dt>Lesson texts</dt><dd>${texts}</dd>` +
    `<dt>Vocabulary</dt><dd>${esc(body.vocabulary.addressed.map((entry) => entry.term).join(', '))}${vocabularySupport}</dd>` +
    `<dt>Materials</dt><dd>${esc(body.materials.join('; '))}</dd>` +
    '</dl>' +
    '<h2 class="dh">Student learning objectives</h2><ol>' +
    `<li><b>Content.</b> ${rich(body.objectives.content)}</li>` +
    `<li><b>Language.</b> ${rich(body.objectives.language)}</li>` +
    (body.objectives.foundationalSkills
      ? `<li><b>Foundational skills.</b> ${rich(body.objectives.foundationalSkills)}</li>`
      : '') +
    '</ol>' +
    `<h2 class="dh">Essential questions</h2>${items(body.essentialQuestions)}` +
    '<h2 class="dh">Connections</h2><dl class="fm">' +
    `<dt>Knowledge-building</dt><dd>${rich(body.connections.knowledgeBuilding)}</dd>` +
    `<dt>Enduring understanding</dt><dd>${rich(body.connections.enduringUnderstanding)}</dd>` +
    `<dt>Future lessons</dt><dd>${rich(body.connections.futureLessons)}</dd>` +
    `<dt>Unit performance task</dt><dd>${rich(body.connections.unitPerformanceTask)}</dd>` +
    '</dl>' +
    `<h2 class="dh">Lesson pacing</h2>${pacingTable(body.sections, frontMatter.durationMinutes)}` +
    join(body.sections, (section, index) => sectionHtml(section, index, anchors)) +
    homework +
    standardsSection(lesson.standards) +
    '</article>'
  )
}

// STYLE.md tokens: ink, rules and the four section hues. Inline only (no @import, no url()).
const STYLE = `*{box-sizing:border-box}
body{margin:0;background:#eef1f4;color:#1c2430;font:17px/28px Georgia,"Times New Roman",serif}
main{max-width:820px;margin:32px auto;padding:0 16px}
.doc,.unit-head{background:#fff;border:1px solid #d5dbe2;border-radius:8px;padding:40px 48px;margin-bottom:32px}
h1{font-size:32px;line-height:40px;margin:4px 0 8px}
h2{font-size:22px;line-height:30px;margin:32px 0 12px}
h3{font-size:18px;margin:20px 0 8px}h4{font-size:16px;margin:16px 0 6px}h5{font:600 14px/20px system-ui,sans-serif;margin:12px 0 4px}
.kicker,.meta,.caption,.chip,caption,th,.mins,.bt,.g{font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
.kicker{font-size:14px;color:#4a5568;text-transform:uppercase;letter-spacing:.04em}
.meta,.caption{font-size:14px;line-height:20px;color:#4a5568}.meta span+span::before{content:" · "}
.notice{font:15px/22px system-ui,sans-serif;padding:8px 12px;border-radius:6px;margin:16px 0}
.notice.ok{background:#dcf2e3;color:#166534}.notice.draft{background:#fcefcf;color:#7a4e00}
dl.fm{display:grid;grid-template-columns:200px 1fr;gap:8px 16px;margin:16px 0}dt{font-weight:700}dd{margin:0}
.chip{display:inline-block;border:1px solid #aeb7c2;border-radius:6px;padding:0 6px;margin:2px 2px 2px 0;font-size:13px;font-weight:600;line-height:22px;background:#fff}
.chip.warn{border-color:#7a4e00;background:#fcefcf;color:#7a4e00}
table{border-collapse:collapse;width:100%;margin:12px 0}td,th{border-bottom:1px solid #d5dbe2;padding:8px;text-align:left;vertical-align:top}
th{font-size:14px;color:#4a5568}caption{text-align:left;font-size:14px;color:#4a5568;padding-bottom:4px}
td.flow{white-space:nowrap;font-weight:700;border-left:4px solid #aeb7c2}
.sec-h{display:flex;justify-content:space-between;align-items:baseline;border-bottom:3px solid #aeb7c2;margin-top:40px}
.sec-h h2{margin:0 0 4px}.no{display:inline-block;min-width:1.4em}.mins{font-size:14px;color:#4a5568}
.launch .sec-h,td.flow.launch{border-color:#b87a00}.launch h2{color:#8a5b00}
.lab .sec-h,td.flow.lab{border-color:#008a7a}.lab h2{color:#00715f}
.action .sec-h,td.flow.action{border-color:#4f46c8}.action h2{color:#4f46c8}
.lookback .sec-h,td.flow.lookback{border-color:#c23a62}.lookback h2{color:#c23a62}
.homework .sec-h{border-color:#5e6b7a}
.blk{margin:8px 0}.blk .g{font-weight:700}.blk.ex{margin-left:28px;font-style:italic}.blk.ex .g{display:block;font-size:13px;font-style:normal}
.disp{display:block;border:1px dashed #aeb7c2;padding:8px 12px;margin-top:4px}
.box{border:1px solid #d5dbe2;border-left:4px solid #4a5568;border-radius:4px;padding:12px 16px;margin:16px 0}
.box.eld{border-left-color:#4f46c8}.box.tip{border-left-color:#b87a00}.bt{font-weight:700;font-size:15px;margin-bottom:4px}
.opts li{margin:6px 0}.opts .correct{color:#166534}.why{font-size:15px;color:#4a5568}
nav ol{columns:2;padding-left:20px}nav a{color:#1c2430}
@media print{body{background:#fff}.doc,.unit-head{border:0;padding:0}.doc{break-before:page}}
@media (max-width:640px){.doc,.unit-head{padding:20px}dl.fm{grid-template-columns:1fr}nav ol{columns:1}}`

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${STYLE}</style>
</head>
<body><main>${body}</main></body>
</html>
`
}

/** One lesson as a standalone HTML document (R16, R19 layout). */
export function renderLessonHtml(data: LessonExport): string {
  const anchors: Anchors = { section: sectionAnchor }
  return page(
    lessonHeadingText(data.lesson.content),
    lessonArticle(data.lesson, data.unit.unitNumber, anchors),
  )
}

/** The approved lessons of a unit in one document, with a table of contents (R16). */
export function renderUnitHtml(data: UnitExport): string {
  const heading = `Unit ${data.unit.unitNumber}: ${data.unit.anchorTextTitle}`
  const articleId = (lesson: ExportedLesson) => `lesson-${lesson.id}`
  const contents =
    data.lessons.length > 0
      ? `<nav aria-label="Contents"><h2>Contents</h2><ol>${join(
          data.lessons,
          (lesson) =>
            `<li><a href="#${esc(articleId(lesson))}">${esc(lessonHeadingText(lesson.content))}</a></li>`,
        )}</ol></nav>`
      : '<nav aria-label="Contents"><h2>Contents</h2><p class="caption">No lessons are approved yet.</p></nav>'
  const head =
    '<header class="unit-head">' +
    `<div class="kicker">Grade ${esc(data.unit.grade)}</div>` +
    `<h1>${esc(heading)}</h1>` +
    `<p class="meta">${esc(data.counts.exported)} of ${esc(data.counts.total)} lessons approved and included</p>` +
    contents +
    '</header>'
  const articles = join(data.lessons, (lesson) =>
    lessonArticle(
      lesson,
      data.unit.unitNumber,
      { section: (kind) => `${articleId(lesson)}-${sectionAnchor(kind)}` },
      articleId(lesson),
    ),
  )
  return page(heading, head + articles)
}
