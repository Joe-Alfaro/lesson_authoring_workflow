// R1, R3, R4, R5 import. Mockups: docs/design/lesson-authoring/R1-import-empty.html,
// R1-import-parsing.html, R1-import-error.html and R4-import-preview.html.
import type { Page } from '@playwright/test'
import {
  PRIVATE_SHEET_LINK,
  SAMPLE_ELD_CSV,
  SAMPLE_OUTLINE_CSV,
  expect,
  expectNoAxeViolations,
  openImportForm,
  signIn,
  snap,
  test,
} from './support'

const SHARE_ERROR =
  'This sheet isn\'t shared by link, so it can\'t be read. In Google Sheets choose Share, set General access to "Anyone with the link", then import again. No unit was created.'

const PREVIEW_TITLE = 'Check the outline before creating the unit'

/**
 * Holds every POST the page sends (a fetch to /api/imports or a server action) until the returned
 * function is called, so the transient parsing state can be seen.
 */
async function holdPosts(page: Page): Promise<() => Promise<void>> {
  let release!: () => void
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/*', async (route) => {
    if (route.request().method() === 'POST') {
      await released
    }
    await route.continue()
  })
  return async () => {
    release()
    await page.unrouteAll({ behavior: 'wait' })
  }
}

/** Picks "Upload CSV", chooses the sample outline and, optionally, the sample ELD file. */
async function readSampleOutline(page: Page, options: { eld?: boolean } = {}): Promise<void> {
  await page.getByRole('tab', { name: 'Upload CSV' }).click()
  // The Upload CSV panel isn't drawn; its file input is expected to be labelled "CSV file".
  await page.getByLabel(/csv file/i).setInputFiles(SAMPLE_OUTLINE_CSV)
  if (options.eld) {
    await page.getByLabel(/ELD scope and sequence/).setInputFiles(SAMPLE_ELD_CSV)
  }
  await page.getByRole('button', { name: 'Read outline' }).click()
  await expect(page.getByRole('heading', { level: 1, name: PREVIEW_TITLE })).toBeVisible({
    timeout: 30_000,
  })
}

function lessonRow(page: Page, lessonNumber: number) {
  return page
    .getByRole('table')
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: String(lessonNumber), exact: true }) })
}

test.describe('R1 import form', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await openImportForm(page)
  })

  test('empty state: link or CSV source, optional ELD file, outline help', async ({
    page,
  }, testInfo) => {
    await snap(page, testInfo, 'R1-import-empty')

    // Breadcrumb back to Units.
    await expect(page.getByRole('main').getByRole('link', { name: 'Units' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Outline', exact: true })).toBeVisible()

    const source = page.getByRole('tablist', { name: 'Outline source' })
    await expect(source.getByRole('tab')).toHaveText(['Google Sheets link', 'Upload CSV'])
    await expect(source.getByRole('tab', { name: 'Google Sheets link' })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    const link = page.getByLabel('Sheet link')
    await expect(link).toHaveAttribute('placeholder', 'https://docs.google.com/spreadsheets/d/...')
    await expect(link).toHaveAccessibleDescription(
      'The sheet must be shared as "Anyone with the link can view". No Google sign-in is needed.',
    )

    await expect(page.getByText('ELD scope and sequence')).toBeVisible()
    await expect(page.getByText('(optional)')).toBeVisible()
    await expect(page.getByText('Attach an ELD file')).toBeVisible()
    await expect(
      page.getByText(
        'Rows are matched to lessons by arc, lesson number and type. Empty fields are ignored.',
      ),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Choose file' })).toBeVisible()

    await expect(page.getByRole('button', { name: 'Read outline' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible()

    await expect(page.getByRole('heading', { name: 'What the outline needs' })).toBeVisible()
    await expect(page.getByRole('listitem')).toContainText([
      'A banner row with grade, unit, anchor text and ISBN.',
      'A header row, then arc rows, lesson rows, flex days and a totals row.',
      'Standards codes in the focus and supporting columns, for example RL.6.1, L.6.4.b.',
    ])
    await expect(
      page.getByText("You'll see every lesson and any warnings before a unit is created."),
    ).toBeVisible()
    await expectNoAxeViolations(page)
  })

  test('the source control switches to Upload CSV', async ({ page }) => {
    const source = page.getByRole('tablist', { name: 'Outline source' })
    await source.getByRole('tab', { name: 'Upload CSV' }).click()
    await expect(source.getByRole('tab', { name: 'Upload CSV' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(source.getByRole('tab', { name: 'Google Sheets link' })).toHaveAttribute(
      'aria-selected',
      'false',
    )
    await expect(page.getByLabel(/csv file/i)).toBeAttached()
  })

  test('Cancel returns to Units without creating anything', async ({ page, db }) => {
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Units' })).toBeVisible()
    expect(await db.count('units')).toBe(0)
  })

  test('parsing state: progress, steps and Cancel while the outline is read', async ({
    page,
  }, testInfo) => {
    const release = await holdPosts(page)
    await page.getByLabel('Sheet link').fill(PRIVATE_SHEET_LINK)
    await page.getByRole('button', { name: 'Read outline' }).click()

    await expect(page.getByRole('heading', { name: 'Reading the outline' })).toBeVisible()
    await snap(page, testInfo, 'R1-import-parsing')
    await expect(
      page.getByText(
        'From the Google Sheets link. Nothing is saved until you confirm the preview.',
      ),
    ).toBeVisible()
    await expect(page.getByRole('progressbar', { name: 'Reading outline' })).toBeVisible()
    for (const step of [
      'Fetched the sheet',
      'Reading rows: banner, arcs, lessons, flex days',
      'Matching standards codes to the reference data',
      'Matching ELD rows to lessons',
    ]) {
      await expect(page.getByText(step)).toBeVisible()
    }
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible()

    await release()
    await expect(page.getByText(SHARE_ERROR)).toBeVisible({ timeout: 30_000 })
  })

  test('error state: a sheet not shared by link explains how to share it and creates no unit', async ({
    page,
    db,
  }, testInfo) => {
    const link = page.getByLabel('Sheet link')
    await link.fill(PRIVATE_SHEET_LINK)
    await page.getByRole('button', { name: 'Read outline' }).click()

    await expect(page.getByText(SHARE_ERROR)).toBeVisible({ timeout: 30_000 })
    await snap(page, testInfo, 'R1-import-error')
    await expect(link).toHaveAttribute('aria-invalid', 'true')
    await expect(link).toHaveAccessibleDescription(SHARE_ERROR)
    await expect(link).toHaveValue(PRIVATE_SHEET_LINK)
    await expect(page.getByRole('heading', { level: 1, name: 'Import an outline' })).toBeVisible()

    expect(await db.count('units')).toBe(0)
    expect(await db.count('pending_imports')).toBe(0)
    await expectNoAxeViolations(page)
  })
})

// R1 live check: needs an "anyone with the link" sheet holding the scrubbed sample.
test.describe('R1 import from the shared test sheet', () => {
  const sheetUrl = process.env.IMPORT_TEST_SHEET_URL?.trim() ?? ''
  test.skip(!sheetUrl, 'IMPORT_TEST_SHEET_URL is not set')

  test('the shared test sheet link imports the same preview as the CSV', async ({ page }) => {
    await signIn(page)
    await openImportForm(page)
    await page.getByLabel('Sheet link').fill(sheetUrl)
    await page.getByRole('button', { name: 'Read outline' }).click()
    await expect(page.getByRole('heading', { level: 1, name: PREVIEW_TITLE })).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByRole('main')).toContainText(/41\s*lessons/)
  })
})

test.describe('R4 import preview', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await openImportForm(page)
  })

  test('lists every lesson with standards and warnings before anything is created', async ({
    page,
    db,
  }, testInfo) => {
    await readSampleOutline(page)
    await snap(page, testInfo, 'R4-import-preview')

    // Focus lands on the page title after parsing.
    await expect(page.getByRole('heading', { level: 1, name: PREVIEW_TITLE })).toBeFocused()

    const main = page.getByRole('main')
    await expect(main).toContainText(
      'Grade 6, Unit 4: The Lightning Thief by Rick Riordan, ISBN 9780786838653',
    )
    await expect(main).toContainText(/41\s*lessons/)
    await expect(main).toContainText(/4\s*arcs/)
    await expect(main).toContainText(/6\s*flex days, not generated/)
    await expect(main).toContainText(/1\s*unknown standard code in 3 lessons/)

    const table = page.getByRole('table')
    await expect(table.getByRole('columnheader')).toHaveText([
      '#',
      'Type',
      'Title or description',
      'Focus standards',
      'Warnings',
    ])
    for (const arc of ['Spark', 'Investigation 1', 'Investigation 2', 'Showcase']) {
      await expect(table.getByRole('row', { name: arc, exact: true })).toHaveCount(1)
    }
    await expect(
      table.getByRole('row').filter({ has: page.getByRole('cell', { name: /^\d{1,2}$/ }) }),
    ).toHaveCount(41)
    await expect(lessonRow(page, 1)).toContainText('What Are Myths?')
    await expect(lessonRow(page, 41)).toContainText('Performance Task')

    // R3: normalized codes show the text they were read from.
    const lesson4 = lessonRow(page, 4)
    await expect(lesson4).toContainText('Core Reading')
    await expect(lesson4).toContainText('Chapter 1')
    await expect(lesson4).toContainText('pp. 1–8')
    for (const code of ['RL.6.1', 'RL.6.2', 'L.6.4']) {
      await expect(lesson4.getByText(code, { exact: true })).toBeVisible()
    }
    await expect(lesson4).toContainText('Read from "RL.6.1, 6.2 L.6.4"')

    // R3: an unknown code is kept and flagged with text, not colour alone.
    const lesson22 = lessonRow(page, 22)
    await expect(lesson22.getByText('RL.6.9', { exact: true })).toBeVisible()
    await expect(lesson22).toContainText("RL.6.9.a isn't in the standards reference data.")
    await expect(lesson22).toContainText('Kept as written; check the code.')

    // Flex days are muted rows after their arc, stored but not generated.
    await expect(table.getByRole('row').filter({ hasText: 'End-of-arc flex day' })).toHaveCount(3)
    await expect(
      table.getByText('2 flex days, stored but not generated. You can generate a flex day later.'),
    ).toHaveCount(3)

    await expect(
      page.getByText('Nothing has been saved yet. Cancelling discards this import.'),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Cancel import' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create unit with 41 lessons' })).toBeVisible()

    expect(await db.count('units')).toBe(0)
    await expectNoAxeViolations(page)
  })

  test('Create unit saves the unit with 41 lessons and 6 flex days', async ({ page, db }) => {
    await readSampleOutline(page)
    await page.getByRole('button', { name: 'Create unit with 41 lessons' }).click()

    await expect(page).toHaveURL(/\/units\/[0-9a-f-]{36}/)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('The Lightning Thief')
    expect(await db.count('units')).toBe(1)
    expect(await db.count('arcs')).toBe(4)
    expect(await db.lessonCounts()).toEqual({ lessons: 41, flexDays: 6 })
    expect(await db.count('pending_imports')).toBe(0)
  })

  test('Cancel import discards the import and leaves no unit', async ({ page, db }) => {
    await readSampleOutline(page)
    expect(await db.count('pending_imports')).toBe(1)

    await page.getByRole('button', { name: 'Cancel import' }).click()

    await expect(page.getByRole('heading', { level: 1, name: 'Units' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'No units yet' })).toBeVisible()
    expect(await db.count('units')).toBe(0)
    expect(await db.count('pending_imports')).toBe(0)
  })
})

test.describe('R5 optional ELD file', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await openImportForm(page)
  })

  test('the preview summarizes the attached ELD file and lists unmatched rows', async ({
    page,
  }, testInfo) => {
    await readSampleOutline(page, { eld: true })
    await snap(page, testInfo, 'R5-import-preview-eld')

    const main = page.getByRole('main')
    await expect(main).toContainText('ELD file attached: 45 rows, every content column is empty.')
    await expect(main).toContainText(
      "Nothing from it will be added to the generation input; ELD support comes from the outline's Designated ELD Standards column.",
    )
    await expect(main).toContainText("Rows that didn't match a lesson:")
    // D-028: rows without a matching arc and type fall back to the L<n>_ number, so the
    // Investigation 1 rows match; rows past lesson 41 still don't.
    await expect(main).toContainText('L45_DELD_TE_G8_U4_CA_Core')
    await expect(main).not.toContainText('L4_DELD_TE_G8_U4_CA_Core')
  })

  test('the unit keeps the unmatched ELD rows and shows them after it is created', async ({
    page,
  }, testInfo) => {
    await readSampleOutline(page, { eld: true })
    await page.getByRole('button', { name: 'Create unit with 41 lessons' }).click()
    await expect(page).toHaveURL(/\/units\/[0-9a-f-]{36}/)

    await page.reload()
    await snap(page, testInfo, 'R5-unit-eld-warnings')
    await expect(page.getByRole('main')).toContainText('L45_DELD_TE_G8_U4_CA_Core')
  })

  test('without an ELD file the preview shows no ELD notice', async ({ page }) => {
    await readSampleOutline(page)
    await expect(page.getByText(/ELD file attached/)).toHaveCount(0)
  })
})
