// Layout of the exported unit HTML in a real browser (jsdom has no layout): long lesson titles in
// the table of contents wrap inside their column instead of running past it, and so do the lesson
// headings that repeat them. No app or database
// is needed; the HTML is rendered straight from src/export/html.ts.
import { expect, test, type Page } from '@playwright/test'
import { renderUnitHtml } from '../../src/export/html'
import type { ExportedLesson, UnitExport } from '../../src/export/types'
import { richLessonContent } from '../fixtures/lesson/rich_lesson_fixture'

const LONG_TITLES = [
  'Tracing how the narrator’s distrust of adults grows across the opening chapters and what it suggests about the central conflict of the novel',
  'Comparing the myth retellings: OverwhelminglyUnbreakableCompoundTitleWordThatHasNoSpacesAtAllAndKeepsGoingPastTheColumnEdge',
  'Short title',
  'A/very/long/path-like/title/with/slashes/only/that/browsers/do/not/break/by/default/at/all/anywhere',
]

function unitWithLongTitles(): UnitExport {
  const arc = { id: '22222222-2222-4222-8222-222222222222', name: 'Investigation 1', position: 0 }
  const lessons: ExportedLesson[] = LONG_TITLES.map((title, index) => {
    const content = richLessonContent()
    content.frontMatter.number = index + 1
    content.body.title = title
    return {
      id: `44444444-4444-4444-8444-44444444444${index}`,
      unitId: '11111111-1111-4111-8111-111111111111',
      number: index + 1,
      isFlex: false,
      position: index,
      filename: `L${index + 1}_TE`,
      lessonType: 'Core Reading',
      arc,
      status: 'approved',
      approved: true,
      approval: {
        by: { id: '33333333-3333-4333-8333-333333333333', name: 'Approver 01' },
        at: '2026-10-25T15:30:00.000Z',
      },
      standards: [],
      content,
    }
  })
  return {
    exportVersion: 1,
    exportedAt: '2026-10-25T16:00:00.000Z',
    unit: {
      id: '11111111-1111-4111-8111-111111111111',
      grade: 6,
      unitNumber: 4,
      anchorTextTitle: 'Placeholder Anchor Novel',
      isbn: null,
      arcs: [arc],
    },
    lessons,
    skipped: [],
    counts: { total: lessons.length, exported: lessons.length, skipped: 0 },
  }
}

/** Contents links whose text runs past the right edge of their list item, by text. */
async function overflowingLinks(page: Page): Promise<string[]> {
  return page
    .getByRole('navigation', { name: 'Contents' })
    .getByRole('listitem')
    .evaluateAll((items) =>
      items.flatMap((item) => {
        const right = item.getBoundingClientRect().right
        const link = item.querySelector('a')!
        const overflows = [...link.getClientRects()].some((rect) => rect.right > right + 0.5)
        return overflows ? [link.textContent ?? ''] : []
      }),
    )
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 375, height: 800 },
]) {
  test(`long contents titles wrap inside their column at ${viewport.width} px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    await page.setContent(renderUnitHtml(unitWithLongTitles()))
    const links = page.getByRole('navigation', { name: 'Contents' }).getByRole('link')
    await expect(links).toHaveCount(LONG_TITLES.length)
    expect(await overflowingLinks(page)).toEqual([])
    // The same titles head each lesson's article.
    const headings = page.getByRole('heading', { level: 1 })
    const clipped = await headings.evaluateAll((elements) =>
      elements
        .filter((element) => element.scrollWidth > element.clientWidth)
        .map((element) => element.textContent ?? ''),
    )
    expect(clipped).toEqual([])
  })
}
