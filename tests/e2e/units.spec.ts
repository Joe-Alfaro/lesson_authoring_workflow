// App shell (top bar) and R1 Units, empty. Mockup: docs/design/lesson-authoring/R1-units-empty.html.
import {
  AUTHOR,
  expect,
  expectNoAxeViolations,
  importOutlineAction,
  signIn,
  snap,
  test,
} from './support'

test.describe('App shell and Units, empty', () => {
  test.beforeEach(async ({ page, db }) => {
    expect(await db.count('units')).toBe(0)
    await signIn(page)
  })

  test('the top bar has the product mark, the main nav and the signed-in user with a role chip', async ({
    page,
  }) => {
    const banner = page.getByRole('banner')
    await expect(banner.getByRole('link', { name: 'Lesson Studio' })).toBeVisible()

    const nav = banner.getByRole('navigation', { name: 'Main' })
    await expect(nav.getByRole('link')).toHaveText(['Units', 'My lessons', 'Prompts'])

    await expect(banner.getByText(AUTHOR.name, { exact: true })).toBeVisible()
    await expect(banner.getByText(AUTHOR.role, { exact: true })).toBeVisible()
  })

  test('Units with no units invites the author to import an outline', async ({
    page,
  }, testInfo) => {
    const nav = page.getByRole('navigation', { name: 'Main' })
    await nav.getByRole('link', { name: 'Units' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Units' })).toBeVisible()
    await snap(page, testInfo, 'R1-units-empty')

    await expect(nav.getByRole('link', { name: 'Units' })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('heading', { level: 2, name: 'No units yet' })).toBeVisible()
    await expect(
      page.getByText(
        'Import a unit outline to start. Each numbered row becomes a lesson you can generate, edit and send for review.',
      ),
    ).toBeVisible()
    await expect(importOutlineAction(page)).toBeVisible()
    await expectNoAxeViolations(page)
  })

  test('"Import an outline" opens the import form', async ({ page }) => {
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Units' })
      .click()
    await importOutlineAction(page).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Import an outline' })).toBeVisible()
  })
})
