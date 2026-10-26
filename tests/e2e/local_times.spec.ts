// User-facing times in a browser whose time zone isn't the server's. The e2e app runs in UTC (like
// production, playwright.config.ts) and these pages load in America/Chicago: every time must show
// in the viewer's zone, and the page must hydrate without React's text-mismatch error (#418).
import type { Page } from '@playwright/test'
import { richLessonContent } from '../fixtures/lesson/rich_lesson_fixture'
import { addVersion, APPROVER_1, createLesson } from './lesson_support'
import { expect, openUnit, seedReviewState, test } from './dashboard_support'
import { signIn } from './support'

test.use({ timezoneId: 'America/Chicago' })

/** 02:07 UTC on Mar 11 is 21:07 CDT on Mar 10 in Chicago: the day and the hour both differ. */
const AT = new Date('2026-03-11T02:07:00.000Z')

/** Console errors and uncaught page errors from the moment this is called. */
function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  return errors
}

function hydrationErrors(errors: string[]): string[] {
  return errors.filter((text) => /hydrat|#418|didn't match|did not match/i.test(text))
}

test.describe('Times in the viewer time zone', () => {
  test('the editor: approval lock notice, versions and status history', async ({ page, pool }) => {
    const { lessonId } = await createLesson(pool, { status: 'approved' })
    await addVersion(pool, lessonId, richLessonContent(), APPROVER_1.email, AT)
    await pool.query(
      `INSERT INTO workflow_events (lesson_id, from_status, to_status, actor_id, note, at)
       VALUES ($1, 'in_review', 'approved', (SELECT id FROM users WHERE email = $2), NULL, $3)`,
      [lessonId, APPROVER_1.email, AT],
    )
    await signIn(page, APPROVER_1.email)
    const errors = collectErrors(page)

    await page.goto(`/lessons/${lessonId}`)
    await expect(page.getByRole('status').filter({ hasText: 'editing is locked' })).toContainText(
      'Approver 01 approved it on Mar 10 at 21:07.',
    )

    await page.getByRole('button', { name: 'Version history' }).click()
    const versions = page.getByRole('tabpanel', { name: 'Versions' })
    await expect(versions.getByRole('listitem').first()).toContainText('Mar 10, 21:07')

    await page.getByRole('tab', { name: 'History' }).click()
    const history = page.getByRole('tabpanel', { name: 'History' })
    await expect(history.getByRole('listitem').first()).toContainText('Mar 10, 21:07')

    expect(hydrationErrors(errors)).toEqual([])
  })

  test('the unit list, the dashboard and the prompt editor', async ({ page, pool, dash }) => {
    const unit = await dash.importSampleUnit()
    const runId = await seedReviewState(dash, unit)
    await pool.query('UPDATE units SET created_at = $2 WHERE id = $1', [unit.unitId, AT])
    await pool.query('UPDATE lessons SET updated_at = $2 WHERE id = $1', [
      unit.lessonIds.get(1),
      AT,
    ])
    await pool.query('UPDATE generation_runs SET created_at = $2, finished_at = $2 WHERE id = $1', [
      runId,
      AT,
    ])
    await pool.query('UPDATE prompt_versions SET created_at = $2 WHERE unit_id = $1', [
      unit.unitId,
      AT,
    ])
    await signIn(page)
    const errors = collectErrors(page)

    await page.goto('/units')
    const unitRow = page.getByRole('row').filter({ hasText: unit.heading })
    await expect(unitRow.getByRole('cell').last()).toHaveText('Mar 10, 2026')

    await openUnit(page, unit)
    await expect(page.getByText(/Generation finished at/)).toContainText(
      'Generation finished at 21:07 with prompt v1.',
    )
    const row = page.getByRole('row').filter({
      has: page.getByRole('checkbox', { name: 'Select lesson 1', exact: true }),
    })
    await expect(row.getByRole('cell').filter({ hasText: /^Mar \d+$/ })).toHaveText('Mar 10')

    await page.goto(`/units/${unit.unitId}/prompt`)
    await expect(
      page.getByRole('link', { name: /^v1/ }).filter({ hasText: 'Mar 10 at 21:07' }),
    ).toBeVisible()

    expect(hydrationErrors(errors)).toEqual([])
  })
})
