// R16 entry points beyond the row menu and the banner: the dashboard header's Export menu and the
// lesson view's HTML button both download from the export routes, so one renderer (src/export)
// makes every HTML file. Contract: src/export/README.md (UI).
import { readFile } from 'node:fs/promises'
import type { Download, Locator, Page } from '@playwright/test'
import { expect, openUnit, seedReviewState, seededTitle, test } from './dashboard_support'
import { signIn } from './support'

async function downloadFrom(page: Page, target: Locator): Promise<Download> {
  const [download] = await Promise.all([page.waitForEvent('download'), target.click()])
  return download
}

async function contents(download: Download): Promise<string> {
  return readFile(await download.path(), 'utf8')
}

test.describe('Export entry points (R16)', () => {
  test('the dashboard header Export menu downloads the unit as JSON and as HTML', async ({
    page,
    dash,
  }) => {
    const unit = await dash.importSampleUnit()
    await seedReviewState(dash, unit)
    await signIn(page)
    await openUnit(page, unit)

    const exportButton = page.getByRole('button', { name: 'Export', exact: true })
    await expect(exportButton).toBeEnabled()
    await expect(exportButton).not.toHaveAttribute('title', /R16/)
    await expect(exportButton).toHaveAttribute('aria-haspopup', 'menu')

    await exportButton.click()
    const json = await downloadFrom(
      page,
      page.getByRole('menu').getByRole('menuitem', { name: 'Download unit JSON' }),
    )
    expect(json.suggestedFilename()).toMatch(/^grade-6-unit-4(-[a-z0-9-]+)?\.json$/)
    const body = JSON.parse(await contents(json))
    expect(body.unit).toMatchObject({ id: unit.unitId, grade: 6, unitNumber: 4 })
    // Lessons 1-5 are approved in the review state.
    expect(body.lessons.map((lesson: { number: number | null }) => lesson.number)).toEqual([
      1, 2, 3, 4, 5,
    ])

    await exportButton.click()
    const html = await downloadFrom(
      page,
      page.getByRole('menu').getByRole('menuitem', { name: 'Download unit HTML' }),
    )
    expect(html.suggestedFilename()).toMatch(/^grade-6-unit-4(-[a-z0-9-]+)?\.html$/)
    const document = await contents(html)
    expect(document).toMatch(/<nav[^>]*aria-label="Contents"/)
    expect(document.match(/<article/gi)).toHaveLength(5)
  })

  test('the lesson view HTML button downloads the server export of the lesson', async ({
    page,
    dash,
  }) => {
    const unit = await dash.importSampleUnit()
    await seedReviewState(dash, unit)
    await signIn(page)
    const lessonId = unit.lessonIds.get(1)!
    await page.goto(`/lessons/${lessonId}/view`)

    const html = await downloadFrom(page, page.getByRole('button', { name: 'HTML', exact: true }))
    expect(html.suggestedFilename()).toMatch(/^unit-4-lesson-1(-[a-z0-9-]+)?\.html$/)
    const document = await contents(html)
    const route = await page.request.get(`/api/lessons/${lessonId}/export?format=html`)
    expect(route.status()).toBe(200)
    // Byte for byte what the route renders: one renderer for every HTML export.
    expect(document).toBe(await route.text())
    expect(document).toContain(seededTitle(1))
  })
})
