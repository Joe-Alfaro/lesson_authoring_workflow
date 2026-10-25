// Unit dashboard, review phase: R24 counts, filters and the complete state, R25 assignment and
// My lessons, and the dashboard at 390 wide. Mockups: docs/design/lesson-authoring/
// R24-dashboard-review.html, R24-dashboard-complete.html, R24-dashboard-mobile.html,
// R25-bulk-assign.html and R25-my-lessons.html. Decisions: D-024 (7), D-027, D-030.
import type { Page } from '@playwright/test'
import {
  APPROVER,
  LESSON_COST_USD,
  REVIEW_ASSIGNEES,
  expect,
  lessonRow,
  lessonRows,
  openUnit,
  range,
  reviewStatus,
  reviewer,
  seedCompleteState,
  seedReviewState,
  seededTitle,
  test,
  usd,
} from './dashboard_support'
import { expectNoAxeViolations, signIn, snap } from './support'

const STATUS_LABELS = {
  draft: 'Draft',
  in_review: 'In review',
  changes_requested: 'Changes requested',
  approved: 'Approved',
} as const

function countChips(page: Page) {
  return page.getByRole('group', { name: 'Lessons per status' })
}

/** A count chip: a toggle button such as "In review: 9 lessons, filter". */
function chip(page: Page, label: string, count: number) {
  return countChips(page).getByRole('button', {
    name: new RegExp(`^${label}: ${count} lessons?, filter$`),
  })
}

/** Picks one option of a filter popup (Status, Arc, Assignee) in the filter row. */
async function pickFilter(page: Page, filter: string, option: string): Promise<void> {
  await page
    .getByRole('search', { name: 'Filter lessons' })
    .getByRole('button', { name: new RegExp(`^${filter}\\b`) })
    .click()
  await page.getByRole('option', { name: option, exact: true }).click()
  await page.keyboard.press('Escape')
}

async function visibleLessonNumbers(page: Page): Promise<number[]> {
  const names = await lessonRows(page)
    .getByRole('checkbox', { name: /^Select lesson \d+$/ })
    .evaluateAll((boxes) => boxes.map((box) => box.getAttribute('aria-label') ?? ''))
  return names.map((name) => Number(name.replace('Select lesson ', '')))
}

test.describe('Unit dashboard: review (R24)', () => {
  test('lists lessons with status, assignee, last editor and updated time, and counts per status', async ({
    page,
    dash,
  }, testInfo) => {
    const unit = await dash.importSampleUnit()
    await seedReviewState(dash, unit)
    await signIn(page)
    await openUnit(page, unit)

    await expect(page.getByText('5 of 41 approved')).toBeVisible()
    await expect(page.getByText(/Generation finished at .+ with prompt v1\./)).toBeVisible()
    await expect(page.getByText(`Run cost ${usd(41 * LESSON_COST_USD)}.`)).toBeVisible()
    await expect(chip(page, 'Draft', 24)).toBeVisible()
    await expect(chip(page, 'In review', 9)).toBeVisible()
    await expect(chip(page, 'Changes requested', 2)).toBeVisible()
    await expect(chip(page, 'Approved', 5)).toBeVisible()
    await expect(chip(page, 'Failed', 1)).toBeVisible()
    for (const button of await countChips(page).getByRole('button').all()) {
      await expect(button).toHaveAttribute('aria-pressed', 'false')
    }

    const headers = page.getByRole('columnheader')
    for (const name of ['#', 'Lesson', 'Type', 'Status', 'Assignee', 'Last edited by', 'Updated']) {
      await expect(headers.filter({ hasText: new RegExp(`^${name}$`) })).toHaveCount(1)
    }
    await expect(lessonRows(page)).toHaveCount(41)
    // Lessons are grouped by arc, in outline order.
    for (const arc of unit.arcNames) {
      await expect(page.getByRole('row', { name: arc, exact: true })).toBeVisible()
    }

    const row3 = lessonRow(page, 3)
    await expect(row3.getByRole('link', { name: seededTitle(3) })).toBeVisible()
    await expect(row3).toContainText(unit.outlineLines.get(3)!)
    await expect(row3).toContainText('Approved')
    await expect(row3).toContainText(reviewer(3).name)
    await expect(row3).toContainText(APPROVER.name)
    await expect(lessonRow(page, 15)).toContainText('Changes requested')
    await expect(lessonRow(page, 30)).toContainText('Unassigned')
    await expect(page.locator('body')).not.toContainText('{{')
    await snap(page, testInfo, 'R24-dashboard-review')
    await expectNoAxeViolations(page)
  })

  test('a count chip toggles a status filter; counts ignore filters', async ({ page, dash }) => {
    const unit = await dash.importSampleUnit()
    await seedReviewState(dash, unit)
    await signIn(page)
    await openUnit(page, unit)

    const inReview = chip(page, 'In review', 9)
    await inReview.click()
    await expect(inReview).toHaveAttribute('aria-pressed', 'true')
    await expect(lessonRows(page)).toHaveCount(9)
    expect(await visibleLessonNumbers(page)).toEqual(range(6, 14))
    await expect(chip(page, 'Draft', 24)).toBeVisible()
    await expect(page.getByText('5 of 41 approved')).toBeVisible()

    await inReview.click()
    await expect(inReview).toHaveAttribute('aria-pressed', 'false')
    await expect(lessonRows(page)).toHaveCount(41)
  })

  test('filters by status, arc and assignee, combined, and "Clear filters" resets them', async ({
    page,
    dash,
  }) => {
    const unit = await dash.importSampleUnit()
    await seedReviewState(dash, unit)
    await signIn(page)
    await openUnit(page, unit)

    await pickFilter(page, 'Assignee', reviewer(3).name)
    expect(await visibleLessonNumbers(page)).toEqual(
      Object.entries(REVIEW_ASSIGNEES)
        .filter(([, r]) => r === 3)
        .map(([n]) => Number(n)),
    )

    await pickFilter(page, 'Status', 'Changes requested')
    expect(await visibleLessonNumbers(page)).toEqual([15])

    await page.getByRole('button', { name: 'Clear filters' }).click()
    await expect(lessonRows(page)).toHaveCount(41)
    await expect(page.getByRole('button', { name: 'Clear filters' })).toHaveCount(0)

    const lastArc = unit.arcNames[unit.arcNames.length - 1]!
    await pickFilter(page, 'Arc', lastArc)
    const showcase = await visibleLessonNumbers(page)
    expect(showcase.length).toBeGreaterThan(0)
    expect(showcase).toContain(41)
    expect(showcase).not.toContain(1)

    await page.getByRole('button', { name: 'Clear filters' }).click()
    await pickFilter(page, 'Status', 'Failed')
    expect(await visibleLessonNumbers(page)).toEqual(
      range(1, 41).filter((n) => reviewStatus(n) === 'failed'),
    )
  })

  test('marks the unit complete when every numbered lesson is approved', async ({
    page,
    dash,
  }, testInfo) => {
    const unit = await dash.importSampleUnit()
    await seedCompleteState(dash, unit)
    await signIn(page)
    await openUnit(page, unit)

    const banner = page.getByRole('status').filter({ hasText: 'Unit complete' })
    await expect(banner).toContainText('Unit complete: all 41 lessons approved')
    await expect(banner).toContainText(
      'Approved lessons are locked. An approver can reopen a lesson if it needs another change.',
    )
    await expect(banner.getByRole('button', { name: 'Download unit JSON' })).toBeVisible()
    await expect(banner.getByRole('button', { name: 'Download unit HTML' })).toBeVisible()
    await expect(chip(page, 'Approved', 41)).toBeVisible()
    await snap(page, testInfo, 'R24-dashboard-complete')
  })

  test('is not complete while one numbered lesson is not approved', async ({ page, dash }) => {
    const unit = await dash.importSampleUnit()
    await seedCompleteState(dash, unit)
    await dash.setLesson(unit, 41, { status: 'in_review' })
    await signIn(page)
    await openUnit(page, unit)
    await expect(page.getByText('40 of 41 approved')).toBeVisible()
    await expect(page.getByText('Unit complete: all 41 lessons approved')).toHaveCount(0)
  })

  test('at 390 wide the table becomes stacked rows and the filters collapse into one button', async ({
    page,
    dash,
  }, testInfo) => {
    const unit = await dash.importSampleUnit()
    await seedReviewState(dash, unit)
    await page.setViewportSize({ width: 390, height: 844 })
    await signIn(page)
    await openUnit(page, unit)

    await expect(page.getByText('5 of 41 approved')).toBeVisible()
    await expect(chip(page, 'In review', 9)).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Search lessons' })).toBeVisible()
    const filters = page.getByRole('button', { name: 'Filters', exact: true })
    await expect(filters).toBeVisible()
    await expect(page.getByRole('button', { name: /^Status\b/ })).toBeHidden()
    await expect(page.getByRole('columnheader', { name: 'Last edited by' })).toBeHidden()
    await expect(page.getByRole('link', { name: new RegExp(seededTitle(1)) })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await snap(page, testInfo, 'R24-dashboard-mobile')

    await filters.click()
    await expect(page.getByRole('button', { name: /^Status\b/ })).toBeVisible()
  })
})

test.describe('Assignment and My lessons (R25)', () => {
  test('an approver bulk-assigns selected lessons from a searchable reviewer list with current load', async ({
    page,
    dash,
  }, testInfo) => {
    const unit = await dash.importSampleUnit()
    await seedReviewState(dash, unit)
    await signIn(page, APPROVER.email)
    await openUnit(page, unit)

    const selected = range(20, 25)
    for (const n of selected) {
      await page.getByRole('checkbox', { name: `Select lesson ${n}`, exact: true }).check()
    }
    const bar = page.getByRole('toolbar', { name: 'Bulk actions' })
    await expect(bar).toContainText('6 lessons selected')
    await expect(bar.getByRole('button', { name: 'Regenerate' })).toBeVisible()
    await expect(bar.getByRole('button', { name: 'Clear' })).toBeVisible()
    await bar.getByRole('button', { name: 'Assign' }).click()

    const dialog = page.getByRole('dialog', { name: 'Assign 6 lessons' })
    await expect(dialog).toContainText('Assigning replaces the current assignee on all 6 lessons.')
    // Reviewer 01 has lessons 1 (approved) and 9 (in review): one open assignment.
    await expect(dialog.getByRole('option', { name: /Reviewer 01/ })).toContainText('1 assigned')
    await expect(dialog.getByRole('option', { name: /Reviewer 12/ })).toContainText('0 assigned')
    await snap(page, testInfo, 'R25-bulk-assign')

    await dialog.getByRole('textbox', { name: 'Find a reviewer' }).fill('Reviewer 12')
    await expect(dialog.getByRole('option')).toHaveCount(1)
    await dialog.getByRole('option', { name: /Reviewer 12/ }).click()
    await expect(dialog).toBeHidden()

    const reviewer12 = await dash.userId(reviewer(12).email)
    for (const n of selected) {
      expect((await dash.lessonRow(unit, n)).assignee_id).toBe(reviewer12)
      await expect(lessonRow(page, n)).toContainText(reviewer(12).name)
    }
    await expect(page.getByRole('toolbar', { name: 'Bulk actions' })).toHaveCount(0)
  })

  test('an author assigns one lesson from its row menu', async ({ page, dash }) => {
    const unit = await dash.importSampleUnit()
    await seedReviewState(dash, unit)
    await signIn(page)
    await openUnit(page, unit)

    await page.getByRole('button', { name: 'More actions for lesson 30' }).click()
    await page.getByRole('menuitem', { name: 'Assign...' }).click()
    const dialog = page.getByRole('dialog', { name: /^Assign (1 lesson|lesson 30)$/ })
    await dialog.getByRole('textbox', { name: 'Find a reviewer' }).fill('Reviewer 07')
    await dialog.getByRole('option', { name: /Reviewer 07/ }).click()
    await expect(lessonRow(page, 30)).toContainText(reviewer(7).name)
    expect((await dash.lessonRow(unit, 30)).assignee_id).toBe(await dash.userId(reviewer(7).email))
  })

  test('a reviewer cannot assign lessons', async ({ page, dash }) => {
    const unit = await dash.importSampleUnit()
    await seedReviewState(dash, unit)
    await signIn(page, reviewer(3).email)
    await openUnit(page, unit)
    await page.getByRole('button', { name: 'More actions for lesson 20' }).click()
    await expect(page.getByRole('menuitem', { name: 'Open in editor' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Assign...' })).toHaveCount(0)
  })

  test("My lessons lists a reviewer's assigned lessons by unit, with status counts", async ({
    page,
    dash,
  }, testInfo) => {
    const unit = await dash.importSampleUnit()
    await seedReviewState(dash, unit)
    const reviewer3 = reviewer(3)
    await signIn(page, reviewer3.email)
    const nav = page.getByRole('navigation', { name: 'Main' })
    await nav.getByRole('link', { name: 'My lessons' }).click()

    await expect(page.getByRole('heading', { level: 1, name: 'My lessons' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'My lessons' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(
      page.getByText(`Lessons assigned to you, ${reviewer3.name}, across all units.`),
    ).toBeVisible()
    await expect(chip(page, 'Draft', 1)).toBeVisible()
    await expect(chip(page, 'Changes requested', 1)).toBeVisible()
    await expect(chip(page, 'Approved', 1)).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: unit.heading })).toBeVisible()

    expect(await visibleLessonNumbers(page)).toEqual([3, 15, 19])
    await expect(lessonRow(page, 3)).toContainText(STATUS_LABELS.approved)
    await expect(lessonRow(page, 15)).toContainText(STATUS_LABELS.changes_requested)
    await expect(lessonRow(page, 19)).toContainText(STATUS_LABELS.draft)
    await expect(lessonRow(page, 19).getByRole('link', { name: seededTitle(19) })).toBeVisible()
    await snap(page, testInfo, 'R25-my-lessons')
    await expectNoAxeViolations(page)
  })
})
