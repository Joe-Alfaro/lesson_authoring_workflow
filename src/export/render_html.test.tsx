// R16 (HTML) and R19 layout: an exported lesson or unit is one standalone HTML file in the
// teacher-facing layout, with no scripts and no external assets. Contract: src/export/README.md.
import { within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { richLessonContent } from '../../tests/fixtures/lesson/rich_lesson_fixture'
import type { LessonContent } from '../lesson/schema'
import { renderLessonHtml, renderUnitHtml } from './html'
import type { ExportedLesson, ExportedUnit, LessonExport, UnitExport } from './types'

const HOSTILE = '<script>alert(1)</script><img src=x onerror="alert(2)">'

const UNIT: ExportedUnit = {
  id: '11111111-1111-4111-8111-111111111111',
  grade: 6,
  unitNumber: 4,
  anchorTextTitle: 'Placeholder Anchor Novel',
  isbn: null,
  arcs: [{ id: '22222222-2222-4222-8222-222222222222', name: 'Investigation 1', position: 0 }],
}

const APPROVER = { id: '33333333-3333-4333-8333-333333333333', name: 'Approver 01' }

function exportedLesson(
  overrides: Partial<ExportedLesson> = {},
  content: LessonContent = richLessonContent(),
): ExportedLesson {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    unitId: UNIT.id,
    number: content.frontMatter.number,
    isFlex: content.frontMatter.number === null,
    position: 4,
    filename: 'L4_TE',
    lessonType: 'Core Reading',
    arc: UNIT.arcs[0]!,
    status: 'approved',
    approved: true,
    approval: { by: APPROVER, at: '2026-10-25T15:30:00.000Z' },
    standards: [
      {
        code: 'L.6.4',
        framework: 'CCSS_ELA',
        strand: 'Language Standards, grade 6',
        text: 'Placeholder text for the vocabulary standard.',
      },
      {
        code: 'RL.6.1',
        framework: 'CCSS_ELA',
        strand: 'Reading Standards for Literature, grade 6',
        text: 'Placeholder text for the citing evidence standard.',
      },
      { code: 'RL.6.2', framework: null, strand: null, text: null },
    ],
    content,
    ...overrides,
  }
}

function lessonExport(lesson: ExportedLesson = exportedLesson()): LessonExport {
  return { exportVersion: 1, exportedAt: '2026-10-25T16:00:00.000Z', unit: UNIT, lesson }
}

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html')
}

/**
 * The parsed body copied into the test page, for role queries (a DOMParser document has no
 * window for Testing Library to compute styles and names with).
 */
function mount(doc: Document) {
  const container = document.createElement('div')
  container.innerHTML = doc.body.innerHTML
  document.body.append(container)
  return within(container)
}

afterEach(() => {
  document.body.innerHTML = ''
})

function text(node: Element | null | undefined): string {
  return (node?.textContent ?? '').replace(/\s+/g, ' ').trim()
}

/** No scripts, no external assets, no event handlers (README: HTML). */
function expectStandalone(html: string) {
  expect(html.trimStart().slice(0, 15).toLowerCase()).toBe('<!doctype html>')
  const doc = parse(html)
  expect(doc.documentElement.getAttribute('lang')).toBe('en')
  expect(doc.querySelector('meta[charset]')?.getAttribute('charset')?.toLowerCase()).toBe('utf-8')
  expect(text(doc.querySelector('title'))).not.toBe('')
  expect(doc.querySelectorAll('script, link, img, iframe, object, embed, [src]')).toHaveLength(0)
  const handlers = [...doc.querySelectorAll('*')].flatMap((element) =>
    element.getAttributeNames().filter((name) => name.toLowerCase().startsWith('on')),
  )
  expect(handlers).toEqual([])
  const styles = [...doc.querySelectorAll('style')].map((style) => style.textContent ?? '').join('')
  expect(styles).not.toMatch(/@import|url\(/i)
  expect(html).not.toMatch(/<script/i)
  return doc
}

describe('renderLessonHtml', () => {
  it('is one standalone file: inline styles only, no scripts, no external assets', () => {
    const doc = expectStandalone(renderLessonHtml(lessonExport()))
    expect(doc.querySelectorAll('style').length).toBeGreaterThan(0)
  })

  it('renders the teacher-facing front matter', () => {
    const doc = parse(renderLessonHtml(lessonExport()))
    const body = mount(doc)
    expect(text(body.getByRole('heading', { level: 1 }))).toBe(
      'Lesson 4: Placeholder Lesson: Every Block',
    )
    const frontMatter = doc.querySelector('dl')
    expect(frontMatter).not.toBeNull()
    const terms = [...frontMatter!.querySelectorAll('dt')].map((dt) => text(dt))
    expect(terms).toEqual(
      expect.arrayContaining([
        'Focus standards',
        'Supporting standards',
        'ELD standards',
        'Lesson texts',
      ]),
    )
    const definition = (term: string) =>
      text(
        [...frontMatter!.querySelectorAll('dt')].find((dt) => text(dt) === term)
          ?.nextElementSibling,
      )
    expect(definition('Focus standards')).toContain('RL.6.1')
    expect(definition('Focus standards')).toContain('RL.6.2')
    expect(definition('ELD standards')).toContain('ELD.PI.6.6')
    expect(definition('Lesson texts')).toContain('Placeholder Anchor Novel')
  })

  it('renders the pacing table and the numbered sequence', () => {
    const doc = parse(renderLessonHtml(lessonExport()))
    const pacingRows = [...doc.querySelectorAll('table tr')].map((row) => text(row))
    for (const line of [
      'Launch, 5 min',
      'Literacy Lab, 10 min',
      'Learning in Action, 30 min',
      'Look Back, 5 min',
    ]) {
      expect(pacingRows.some((row) => row.includes(line))).toBe(true)
    }
    const sectionHeadings = [...doc.querySelectorAll('h2')]
      .map((heading) => text(heading))
      .filter((heading) => /^\d+ /.test(heading))
    expect(sectionHeadings).toEqual([
      '1 Launch',
      '2 Literacy Lab',
      '3 Learning in Action',
      '4 Look Back',
    ])
    expect(text(doc.body)).toContain('Today we meet a narrator who says he is not a normal kid.')
    expect(doc.body.querySelector('strong, b')).not.toBeNull()
  })

  it('lists the full text of each known standard, since a static file has no popover', () => {
    const doc = parse(renderLessonHtml(lessonExport()))
    const heading = mount(doc).getByRole('heading', { name: 'Standards' })
    const section = heading.closest('section') ?? heading.parentElement!
    expect(text(section)).toContain('RL.6.1')
    expect(text(section)).toContain('Placeholder text for the citing evidence standard.')
    expect(text(section)).toContain('Placeholder text for the vocabulary standard.')
  })

  it('escapes lesson text: markup typed into a lesson stays text', () => {
    const content = richLessonContent()
    content.body.sections[0]!.parts[0]!.blocks.push({ type: 'say', id: 'b-hostile', text: HOSTILE })
    content.body.title = `Title ${HOSTILE}`
    const html = renderLessonHtml(lessonExport(exportedLesson({}, content)))
    const doc = expectStandalone(html)
    expect(text(doc.body)).toContain('<script>alert(1)</script>')
    expect(text(doc.body)).toContain('Sticky notes for <annotation>')
  })

  it('says who approved an approved lesson, and never "Not approved"', () => {
    const doc = parse(renderLessonHtml(lessonExport()))
    expect(text(doc.body)).toContain('Approved by Approver 01')
    expect(text(doc.body)).not.toMatch(/not approved/i)
  })

  it('dates the approval in UTC and says so, since a static file has no viewer time zone', () => {
    const doc = parse(renderLessonHtml(lessonExport()))
    expect(text(doc.body)).toContain('Approved by Approver 01 on Oct 25, 2026, 15:30 UTC')
    const late = exportedLesson({ approval: { by: APPROVER, at: '2026-10-26T00:05:00.000Z' } })
    expect(text(parse(renderLessonHtml(lessonExport(late))).body)).toContain(
      'on Oct 26, 2026, 00:05 UTC',
    )
  })

  it('marks a lesson that is not approved, naming its status', () => {
    const doc = parse(
      renderLessonHtml(
        lessonExport(exportedLesson({ status: 'in_review', approved: false, approval: null })),
      ),
    )
    expect(text(doc.body)).toContain('Not approved: In review')
    expect(text(doc.body)).not.toContain('Approved by')
  })

  it('labels a flex day without a number', () => {
    const content = richLessonContent()
    content.frontMatter.number = null
    content.frontMatter.type = 'flex'
    const doc = parse(renderLessonHtml(lessonExport(exportedLesson({}, content))))
    expect(text(mount(doc).getByRole('heading', { level: 1 }))).toMatch(/^Flex day: /)
  })
})

describe('renderUnitHtml', () => {
  function unitExport(): UnitExport {
    const second = richLessonContent()
    second.frontMatter.number = 5
    second.body.title = 'Placeholder Lesson Five'
    const flex = richLessonContent()
    flex.frontMatter.number = null
    flex.frontMatter.type = 'flex'
    flex.body.title = 'Placeholder Flex Day'
    const lessons = [
      exportedLesson(),
      exportedLesson(
        { id: '55555555-5555-4555-8555-555555555555', number: 5, position: 5 },
        second,
      ),
      exportedLesson(
        { id: '66666666-6666-4666-8666-666666666666', number: null, isFlex: true, position: 6 },
        flex,
      ),
    ]
    return {
      exportVersion: 1,
      exportedAt: '2026-10-25T16:00:00.000Z',
      unit: UNIT,
      lessons,
      skipped: [
        { id: '77777777-7777-4777-8777-777777777777', number: 6, isFlex: false, status: 'draft' },
      ],
      counts: { total: 4, exported: 3, skipped: 1 },
    }
  }

  it('is one standalone file that opens with the unit heading', () => {
    const doc = expectStandalone(renderUnitHtml(unitExport()))
    // Lessons may keep their own h1 inside their article; the first h1 names the unit.
    expect(text(mount(doc).getAllByRole('heading', { level: 1 })[0])).toContain(
      'Unit 4: Placeholder Anchor Novel',
    )
  })

  it('has a table of contents linking to each lesson in order', () => {
    const doc = parse(renderUnitHtml(unitExport()))
    const nav = mount(doc).getByRole('navigation', { name: 'Contents' })
    const links = within(nav as HTMLElement).getAllByRole('link')
    expect(links.map((link) => text(link))).toEqual([
      'Lesson 4: Placeholder Lesson: Every Block',
      'Lesson 5: Placeholder Lesson Five',
      'Flex day: Placeholder Flex Day',
    ])
    for (const link of links) {
      const href = link.getAttribute('href') ?? ''
      expect(href).toMatch(/^#./)
      const target = doc.getElementById(decodeURIComponent(href.slice(1)))
      expect(target, href).not.toBeNull()
      expect(target!.tagName.toLowerCase()).toBe('article')
    }
    expect(doc.querySelectorAll('article')).toHaveLength(3)
  })

  it('keeps every id unique, so section anchors of different lessons do not collide', () => {
    const doc = parse(renderUnitHtml(unitExport()))
    const ids = [...doc.querySelectorAll('[id]')].map((element) => element.id)
    expect(ids.length).toBeGreaterThan(3)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('renders each lesson in the teacher-facing layout and says how many are included', () => {
    const doc = parse(renderUnitHtml(unitExport()))
    const articles = [...doc.querySelectorAll('article')]
    for (const article of articles) {
      expect(article.querySelector('table')).not.toBeNull()
      const numbered = [...article.querySelectorAll('h2')]
        .map((heading) => text(heading))
        .filter((heading) => /^\d+ /.test(heading))
      expect(numbered).toEqual([
        '1 Launch',
        '2 Literacy Lab',
        '3 Learning in Action',
        '4 Look Back',
      ])
    }
    expect(text(doc.body)).toContain('3 of 4 lessons approved and included')
    expect(text(doc.body)).not.toMatch(/not approved/i)
  })
})
