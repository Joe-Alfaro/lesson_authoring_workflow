// Accessibility of the assign popover (R25) with the list open: axe finds nothing, and the
// reviewer list is reachable by keyboard (validation finding: scrollable-region-focusable).
import { APPROVER, expect, openUnit, seedReviewState, test } from './dashboard_support'
import { expectNoAxeViolations, signIn } from './support'

test.describe('Assign popover accessibility (R25)', () => {
  test('the open bulk and row popovers have no axe violations; the list takes keyboard focus', async ({
    page,
    dash,
  }) => {
    const unit = await dash.importSampleUnit()
    await seedReviewState(dash, unit)
    await signIn(page, APPROVER.email)
    await openUnit(page, unit)

    for (const n of [20, 21]) {
      await page.getByRole('checkbox', { name: `Select lesson ${n}`, exact: true }).check()
    }
    await page
      .getByRole('toolbar', { name: 'Bulk actions' })
      .getByRole('button', { name: 'Assign' })
      .click()
    const bulk = page.getByRole('dialog', { name: 'Assign 2 lessons' })
    await expect(bulk.getByRole('option').first()).toBeVisible()
    await expectNoAxeViolations(page)

    // Tab from the search box reaches the list; arrows move and Enter assigns.
    await expect(bulk.getByRole('textbox', { name: 'Find a reviewer' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(bulk.getByRole('listbox', { name: 'Reviewers' })).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(bulk).toBeHidden()

    await page.getByRole('button', { name: 'More actions for lesson 30' }).click()
    await page.getByRole('menuitem', { name: 'Assign...' }).click()
    const row = page.getByRole('dialog', { name: 'Assign lesson 30' })
    await expect(row.getByRole('option').first()).toBeVisible()
    await expectNoAxeViolations(page)
    await page.keyboard.press('Escape')
    await expect(row).toBeHidden()
  })
})
