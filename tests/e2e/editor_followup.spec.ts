// M3 follow-up (re-validation): codes in the pacing table show their full text (R15); the
// blocked-save button finds the empty field as the doc is now, not as it was at the last check
// (R17); a list item's remove control sits next to the item.
import {
  createLesson,
  editorOf,
  openEditor,
  REVIEWER_1,
  standardText,
  storedContent,
} from './lesson_support'
import { expect, signIn, test } from './support'

test.describe('M3 follow-up', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, REVIEWER_1.email)
  })

  test('standard codes in the pacing table open the standard popover (editor and view)', async ({
    page,
    pool,
  }) => {
    const { lessonId } = await createLesson(pool)
    for (const path of [`/lessons/${lessonId}`, `/lessons/${lessonId}/view`]) {
      await page.goto(path)
      const pacing = page.getByRole('table').filter({ hasText: 'Lesson flow' })
      const code = pacing.getByRole('button', { name: 'Standard RL.6.2' })
      await code.hover()
      await expect(page.getByRole('tooltip')).toContainText(standardText('RL.6.2'))
      await page.mouse.move(0, 0)
      await expect(page.getByRole('tooltip')).toBeHidden()
    }
  })

  test('the blocked-save button goes to the empty field even right after typing elsewhere', async ({
    page,
    pool,
  }) => {
    const { lessonId } = await createLesson(pool)
    await openEditor(page, lessonId)
    await editorOf(page).getByRole('button', { name: 'Add a part' }).click()
    const blocked = page.getByRole('button', { name: /Not saved:/ })
    await expect(blocked).toBeVisible()

    // Type the title and click at once, before the save check has run again.
    await page.keyboard.type('Sharing inferences')
    await blocked.click()
    await page.keyboard.type('Partners share one inference.')

    await expect
      .poll(async () => (await storedContent(pool, lessonId)).body.sections[2]!.parts[2], {
        timeout: 10_000,
      })
      .toMatchObject({
        title: 'Sharing inferences',
        blocks: [{ type: 'paragraph', text: 'Partners share one inference.' }],
      })
  })

  test('a list item’s remove control sits next to the item', async ({ page, pool }) => {
    const { lessonId } = await createLesson(pool)
    await openEditor(page, lessonId)
    const text = editorOf(page).getByText('Read and annotate pp. 9–15.', { exact: true })
    const item = editorOf(page).getByRole('listitem').filter({ hasText: 'Read and annotate' })
    await item.hover()
    const remove = item.getByRole('button', { name: 'Remove item' })
    await expect(remove).toBeVisible()
    const textBox = (await text.boundingBox())!
    const removeBox = (await remove.boundingBox())!
    expect(removeBox.x - (textBox.x + textBox.width)).toBeGreaterThanOrEqual(0)
    expect(removeBox.x - (textBox.x + textBox.width)).toBeLessThan(32)
  })
})
