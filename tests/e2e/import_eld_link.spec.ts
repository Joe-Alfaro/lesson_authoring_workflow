// R1, R5: the optional ELD file can be a CSV or a link to its tab (docs/design/lesson-authoring.md,
// "A drop zone (CSV or link)"). Mockups: R1-import-empty.html, R1-import-error.html.
import {
  PRIVATE_SHEET_LINK,
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

test.describe('R5 ELD file from a sheet link', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await openImportForm(page)
  })

  test('the ELD drop zone offers a CSV or a link to its tab', async ({ page }) => {
    await expect(page.getByRole('main')).toContainText(
      'Attach an ELD file as a CSV or a link to its tab.',
    )
    await expect(page.getByLabel('ELD sheet link')).toHaveCount(0)

    await page.getByRole('button', { name: 'link to its tab' }).click()

    const eldLink = page.getByLabel('ELD sheet link')
    await expect(eldLink).toBeFocused()
    await expect(eldLink).toHaveAttribute(
      'placeholder',
      'https://docs.google.com/spreadsheets/d/...',
    )
    await expectNoAxeViolations(page)
  })

  test('an ELD link that is not shared shows the share error on the ELD field and creates nothing', async ({
    page,
    db,
  }, testInfo) => {
    await page.getByRole('tab', { name: 'Upload CSV' }).click()
    await page.getByLabel(/csv file/i).setInputFiles(SAMPLE_OUTLINE_CSV)
    await page.getByRole('button', { name: 'link to its tab' }).click()
    const eldLink = page.getByLabel('ELD sheet link')
    await eldLink.fill(PRIVATE_SHEET_LINK)
    await page.getByRole('button', { name: 'Read outline' }).click()

    await expect(eldLink).toHaveAccessibleDescription(SHARE_ERROR, { timeout: 30_000 })
    await snap(page, testInfo, 'R5-import-eld-link-error')
    await expect(eldLink).toHaveAttribute('aria-invalid', 'true')
    await expect(eldLink).toHaveValue(PRIVATE_SHEET_LINK)
    await expect(eldLink).toBeFocused()
    // The outline itself was fine, so its field shows no error and keeps the chosen file.
    await expect(page.getByRole('main')).toContainText('lesson_outline.csv')
    await expect(page.getByLabel(/csv file/i)).not.toHaveAttribute('aria-invalid', 'true')
    expect(await db.count('units')).toBe(0)
    expect(await db.count('pending_imports')).toBe(0)
    await expectNoAxeViolations(page)
  })

  test('choosing an ELD file instead of a link drops the link', async ({ page }) => {
    await page.getByRole('button', { name: 'link to its tab' }).click()
    await page.getByLabel('ELD sheet link').fill(PRIVATE_SHEET_LINK)
    await page
      .getByLabel(/ELD scope and sequence/)
      .setInputFiles({ name: 'eld.csv', mimeType: 'text/csv', buffer: Buffer.from('x') })

    await expect(page.getByLabel('ELD sheet link')).toHaveCount(0)
    await expect(page.getByRole('main')).toContainText('eld.csv is attached.')
  })
})
