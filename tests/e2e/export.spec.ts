// R16 export in the browser: the row menu's Download JSON / Download HTML (mockup R11-row-actions)
// and the unit-complete banner's Download unit JSON / HTML (R24-dashboard-complete), which were
// disabled until export existed. Contract: src/export/README.md.
import { readFile } from 'node:fs/promises'
import {
  request as playwrightRequest,
  type Download,
  type Locator,
  type Page,
} from '@playwright/test'
import { LessonContent } from '../../src/lesson/schema'
import { hasContentIds } from '../../src/lesson/content_ids'
import {
  expect,
  openUnit,
  range,
  reviewer,
  seedCompleteState,
  seedReviewState,
  seededTitle,
  test,
} from './dashboard_support'
import { E2E_BASE_URL, E2E_SEED_PASSWORD } from './env'
import { signIn } from './support'

const SAFE_NAME = /^[a-z0-9][a-z0-9-]*\.(json|html)$/

/** Clicks `target` and returns the browser download it starts. */
async function downloadFrom(page: Page, target: Locator): Promise<Download> {
  const [download] = await Promise.all([page.waitForEvent('download'), target.click()])
  return download
}

async function contents(download: Download): Promise<string> {
  const path = await download.path()
  return readFile(path, 'utf8')
}

/** Opens "More actions for lesson N" and returns its menu. */
async function openRowMenu(page: Page, lessonNumber: number): Promise<Locator> {
  await page
    .getByRole('button', { name: `More actions for lesson ${lessonNumber}`, exact: true })
    .click()
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  return menu
}

function plain(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
}

function expectStandaloneHtml(html: string) {
  expect(html.trimStart().slice(0, 15).toLowerCase()).toBe('<!doctype html>')
  expect(html).not.toMatch(/<script|<link|<img|<iframe|\ssrc=|@import|url\(/i)
}

test.describe('Export (R16)', () => {
  test('the row menu downloads an approved lesson as JSON and as HTML', async ({ page, dash }) => {
    const unit = await dash.importSampleUnit()
    await seedReviewState(dash, unit)
    await signIn(page)
    await openUnit(page, unit)

    let menu = await openRowMenu(page, 1)
    const jsonItem = menu.getByRole('menuitem', { name: 'Download JSON' })
    await expect(jsonItem).not.toHaveAttribute('aria-disabled', 'true')
    const json = await downloadFrom(page, jsonItem)
    expect(json.suggestedFilename()).toMatch(SAFE_NAME)
    expect(json.suggestedFilename()).toMatch(/^unit-4-lesson-1(-[a-z0-9-]+)?\.json$/)
    const body = JSON.parse(await contents(json))
    expect(body.exportVersion).toBe(1)
    expect(body.unit).toMatchObject({ id: unit.unitId, grade: 6, unitNumber: 4 })
    expect(body.lesson).toMatchObject({
      id: unit.lessonIds.get(1),
      number: 1,
      status: 'approved',
      approved: true,
    })
    const parsed = LessonContent.safeParse(body.lesson.content)
    expect(parsed.success).toBe(true)
    expect(hasContentIds(parsed.data!)).toBe(true)
    expect(parsed.data!.body.title).toBe(seededTitle(1))

    menu = await openRowMenu(page, 1)
    const htmlItem = menu.getByRole('menuitem', { name: 'Download HTML' })
    await expect(htmlItem).not.toHaveAttribute('aria-disabled', 'true')
    const html = await downloadFrom(page, htmlItem)
    expect(html.suggestedFilename()).toMatch(/^unit-4-lesson-1(-[a-z0-9-]+)?\.html$/)
    const document = await contents(html)
    expectStandaloneHtml(document)
    expect(plain(document)).toContain(seededTitle(1))
    expect(plain(document)).toContain('Launch, 5 min')
    expect(plain(document)).not.toMatch(/not approved/i)
  })

  test('a reviewer downloads a lesson in review, marked not approved', async ({ page, dash }) => {
    const unit = await dash.importSampleUnit()
    await seedReviewState(dash, unit)
    await signIn(page, reviewer(1).email, E2E_SEED_PASSWORD)
    await openUnit(page, unit)

    let menu = await openRowMenu(page, 6)
    const json = await downloadFrom(page, menu.getByRole('menuitem', { name: 'Download JSON' }))
    const body = JSON.parse(await contents(json))
    expect(body.lesson).toMatchObject({ number: 6, status: 'in_review', approved: false })

    menu = await openRowMenu(page, 6)
    const html = await downloadFrom(page, menu.getByRole('menuitem', { name: 'Download HTML' }))
    expect(plain(await contents(html))).toContain('Not approved: In review')
  })

  test('the download items stay disabled for a lesson without content', async ({ page, dash }) => {
    const unit = await dash.importSampleUnit()
    await seedReviewState(dash, unit)
    await signIn(page)
    await openUnit(page, unit)

    // Lesson 17 failed generation, so it has no content to export.
    const menu = await openRowMenu(page, 17)
    await expect(menu.getByRole('menuitem', { name: 'Download JSON' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await expect(menu.getByRole('menuitem', { name: 'Download HTML' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  test('the unit-complete banner downloads the whole unit as JSON and as HTML', async ({
    page,
    dash,
  }) => {
    const unit = await dash.importSampleUnit()
    await seedCompleteState(dash, unit)
    await signIn(page)
    await openUnit(page, unit)

    const banner = page.getByRole('status').filter({ hasText: 'Unit complete' })
    const jsonButton = banner.getByRole('button', { name: 'Download unit JSON' })
    const htmlButton = banner.getByRole('button', { name: 'Download unit HTML' })
    await expect(jsonButton).toBeEnabled()
    await expect(htmlButton).toBeEnabled()

    const json = await downloadFrom(page, jsonButton)
    expect(json.suggestedFilename()).toMatch(/^grade-6-unit-4(-[a-z0-9-]+)?\.json$/)
    const body = JSON.parse(await contents(json))
    expect(body.unit).toMatchObject({ id: unit.unitId, grade: 6, unitNumber: 4 })
    expect(body.unit.arcs.map((arc: { name: string }) => arc.name)).toEqual(unit.arcNames)
    expect(body.lessons.map((lesson: { number: number | null }) => lesson.number)).toEqual(
      range(1, 41),
    )
    expect(body.counts).toEqual({
      total: 41 + unit.flexLessonIds.length,
      exported: 41,
      skipped: unit.flexLessonIds.length,
    })
    for (const lesson of body.lessons) {
      expect(lesson.approved).toBe(true)
      expect(LessonContent.safeParse(lesson.content).success).toBe(true)
    }

    const html = await downloadFrom(page, htmlButton)
    expect(html.suggestedFilename()).toMatch(/^grade-6-unit-4(-[a-z0-9-]+)?\.html$/)
    const document = await contents(html)
    expectStandaloneHtml(document)
    expect(document).toMatch(/<nav[^>]*aria-label="Contents"/)
    expect(document.match(/<article/gi)).toHaveLength(41)
    expect(plain(document)).toContain(`41 of ${41 + unit.flexLessonIds.length} lessons approved`)
    expect(plain(document)).toContain(seededTitle(41))
  })

  test('the export routes answer 401 JSON without a session', async ({ dash }) => {
    const unit = await dash.importSampleUnit()
    await seedCompleteState(dash, unit)
    const anonymous = await playwrightRequest.newContext({ baseURL: E2E_BASE_URL })
    try {
      for (const path of [
        `/api/lessons/${unit.lessonIds.get(1)}/export?format=json`,
        `/api/lessons/${unit.lessonIds.get(1)}/export?format=html`,
        `/api/units/${unit.unitId}/export?format=json`,
        `/api/units/${unit.unitId}/export?format=html`,
      ]) {
        const response = await anonymous.get(path, { maxRedirects: 0 })
        expect(response.status(), path).toBe(401)
        expect(await response.json()).toEqual({ error: expect.any(String) })
      }
    } finally {
      await anonymous.dispose()
    }
  })
})
