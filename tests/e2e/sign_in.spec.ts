// R27 sign-in. Mockups: docs/design/lesson-authoring/R27-sign-in.html, R27-sign-in-error.html.
import { E2E_SEED_PASSWORD } from './env'
import { AUTHOR, expect, expectNoAxeViolations, snap, test } from './support'

test.describe('R27 sign-in', () => {
  test('default state shows the Lesson Studio sign-in form', async ({ page }, testInfo) => {
    await page.goto('/sign-in')
    await snap(page, testInfo, 'R27-sign-in')

    await expect(page.getByRole('heading', { level: 1, name: 'Lesson Studio' })).toBeVisible()
    await expect(page.getByText('Sign in to write, review and approve unit lessons.')).toBeVisible()
    const email = page.getByLabel('Email')
    const password = page.getByLabel('Password')
    await expect(email).toHaveAttribute('type', 'email')
    await expect(email).toHaveAttribute('autocomplete', 'username')
    await expect(password).toHaveAttribute('type', 'password')
    await expect(password).toHaveAttribute('autocomplete', 'current-password')
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
    // Next.js renders its own route announcer with role=alert outside <main>; ignore it.
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0)
    await expectNoAxeViolations(page)
  })

  test('focus order is email, password, Sign in', async ({ page }) => {
    await page.goto('/sign-in')
    await page.getByLabel('Email').focus()
    await page.keyboard.press('Tab')
    await expect(page.getByLabel('Password')).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeFocused()
  })

  test('a wrong password shows one alert, marks no field and focuses the password', async ({
    page,
  }, testInfo) => {
    await page.goto('/sign-in')
    await page.getByLabel('Email').fill('reviewer07@example.com')
    await page.getByLabel('Password').fill('not-the-password')
    // Enter submits (R27 accessibility notes).
    await page.getByLabel('Password').press('Enter')

    const alert = page.getByRole('main').getByRole('alert')
    await expect(alert).toHaveCount(1)
    await expect(alert).toContainText('Email or password is incorrect.')
    await expect(alert).toContainText(
      'Check both and try again. Accounts are created by an admin; there is no self sign-up.',
    )
    await snap(page, testInfo, 'R27-sign-in-error')

    await expect(page.getByLabel('Password')).toBeFocused()
    // The message must not reveal which field was wrong.
    await expect(page.getByLabel('Email')).not.toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByLabel('Password')).not.toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByRole('heading', { level: 1, name: 'Lesson Studio' })).toBeVisible()
    await expectNoAxeViolations(page)
  })

  test('a signed-out visit redirects to sign-in and returns to the page afterwards', async ({
    page,
  }) => {
    await page.goto('/?from=e2e')
    await expect(page).toHaveURL(/\/sign-in\?.*callbackUrl=/)
    await expect(page.getByRole('heading', { level: 1, name: 'Lesson Studio' })).toBeVisible()

    await page.getByLabel('Email').fill(AUTHOR.email)
    await page.getByLabel('Password').fill(E2E_SEED_PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()

    await expect(page).toHaveURL(/\/\?from=e2e$/)
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
  })
})
