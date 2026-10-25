// R17 editor structure, R15 standards (popover and picker), R14 version history and restore, and
// R23 approved lessons opening read-only. Mockups in docs/design/lesson-authoring/:
// R15-standard-picker, R14-version-history, R14-restore-confirm, R23-approved-locked.
import { richLessonContent } from '../fixtures/lesson/rich_lesson_fixture'
import {
  addVersion,
  APPROVER_1,
  caretIn,
  createLesson,
  editorOf,
  openEditor,
  REVIEWER_1,
  REVIEWER_2,
  SAY_TEXT,
  standardText,
  storedContent,
  versionCount,
  withSay,
} from './lesson_support'
import { expect, expectNoAxeViolations, signIn, snap, test } from './support'

test.describe('Lesson editor (R17, R15)', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, REVIEWER_1.email)
  })

  test('shows the lesson structure with typed blocks and derived pacing', async ({
    page,
    pool,
  }) => {
    const { lessonId } = await createLesson(pool)
    const editor = await openEditor(page, lessonId)
    await expect(page.getByRole('navigation', { name: 'Lesson outline' })).toBeVisible()
    for (const section of [
      'Launch',
      'Literacy Lab',
      'Learning in Action',
      'Look Back',
      'Homework',
    ]) {
      await expect(
        editor.getByRole('heading', { level: 2, name: new RegExp(section) }),
      ).toBeVisible()
    }
    await expect(
      page.getByText('Built from the section minutes below. Total 50 of 50 minutes.'),
    ).toBeVisible()
    for (const label of ['Say', 'Ask', 'Exemplar', 'Directions', 'Teacher tip', 'Pulse check']) {
      await expect(editor.getByText(label, { exact: false }).first()).toBeVisible()
    }
    await expect(editor.getByRole('button', { name: 'Add a part' })).toBeVisible()
  })

  test('hovering a standard chip shows its full text', async ({ page, pool }) => {
    const { lessonId } = await createLesson(pool)
    await openEditor(page, lessonId)
    await page.getByRole('button', { name: 'RL.6.2', exact: true }).first().hover()
    await expect(page.getByRole('tooltip')).toContainText(standardText('RL.6.2'))
  })

  test('adds a supporting standard only from the reference data', async ({
    page,
    pool,
  }, testInfo) => {
    const { lessonId } = await createLesson(pool)
    await openEditor(page, lessonId)
    await page.getByRole('button', { name: 'Add supporting standard' }).click()
    const search = page.getByRole('combobox', { name: 'Find a standard' })
    await search.fill('RL.6.3')
    const options = page.getByRole('listbox').getByRole('option')
    await expect(options.first()).toContainText('RL.6.3')
    await expect(options.first()).toContainText(standardText('RL.6.3').slice(0, 40))
    await snap(page, testInfo, 'R15-standard-picker')
    await expectNoAxeViolations(page)

    // A code that isn't in the reference data offers nothing and can't be added as free text.
    await search.fill('XX.9.9')
    await expect(options).toHaveCount(0)
    await search.press('Enter')
    await expect(page.getByRole('button', { name: 'XX.9.9', exact: true })).toHaveCount(0)

    await search.fill('RL.6.3')
    await options.first().click()
    await expect(page.getByRole('button', { name: 'RL.6.3', exact: true })).toBeVisible()
    await expect
      .poll(async () => (await storedContent(pool, lessonId)).frontMatter.supportingStandards, {
        timeout: 10_000,
      })
      .toContain('RL.6.3')
  })
})

test.describe('Version history and restore (R14)', () => {
  test('lists versions, previews one read-only and restores it after confirmation', async ({
    page,
    pool,
  }, testInfo) => {
    const generated = richLessonContent()
    const { lessonId } = await createLesson(pool, { content: withSay('Edited by Reviewer 02.') })
    await addVersion(pool, lessonId, generated, null, new Date('2026-10-25T10:44:00Z'))
    await addVersion(
      pool,
      lessonId,
      withSay('Edited by Reviewer 02.'),
      REVIEWER_2.email,
      new Date('2026-10-25T13:52:00Z'),
    )
    await signIn(page, REVIEWER_1.email)
    await page.goto(`/lessons/${lessonId}`)
    const editor = editorOf(page)
    await expect(editor).toContainText('Edited by Reviewer 02.')

    await page.getByRole('button', { name: 'Version history' }).click()
    const panel = page.getByRole('tabpanel', { name: 'Versions' })
    await expect(page.getByRole('tab', { name: 'Versions' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(
      panel.getByText(
        'A version is saved each time edits pause for 30 seconds, and before any regenerate or restore.',
      ),
    ).toBeVisible()
    const items = panel.getByRole('listitem')
    await expect(items).toHaveCount(2)
    await expect(items.nth(0)).toContainText(REVIEWER_2.name)
    await expect(items.nth(1)).toContainText('System')
    await snap(page, testInfo, 'R14-version-history')

    // Preview the generated version: read-only, with the way back.
    await items.nth(1).getByRole('button').first().click()
    await expect(page.getByText(/Viewing the version from/)).toBeVisible()
    await expect(page.getByRole('article').getByText(SAY_TEXT)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Back to current' })).toBeVisible()

    await page.getByRole('button', { name: 'Restore this version' }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog.getByRole('heading', { name: /Restore the version from/ })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
    await snap(page, testInfo, 'R14-restore-confirm')
    await dialog.getByRole('button', { name: 'Restore version' }).click()

    await expect(editorOf(page)).toContainText(SAY_TEXT)
    await expect(editorOf(page)).not.toContainText('Edited by Reviewer 02.')
    await expect.poll(() => storedContent(pool, lessonId)).toEqual(generated)
    // The restore is itself a version; earlier versions stay.
    await expect.poll(() => versionCount(pool, lessonId)).toBe(3)
    await expect(items).toHaveCount(3)
  })

  test('a restore shows up in another person’s open editor', async ({ browser, page, pool }) => {
    const { lessonId } = await createLesson(pool, { content: withSay('Unwanted edit.') })
    await addVersion(pool, lessonId, richLessonContent(), null, new Date('2026-10-25T10:44:00Z'))
    await signIn(page, REVIEWER_1.email)
    await page.goto(`/lessons/${lessonId}`)
    await expect(editorOf(page)).toContainText('Unwanted edit.')

    const other = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    try {
      const otherPage = await other.newPage()
      await signIn(otherPage, REVIEWER_2.email)
      await otherPage.goto(`/lessons/${lessonId}`)
      await expect(editorOf(otherPage)).toContainText('Unwanted edit.')

      await page.getByRole('button', { name: 'Version history' }).click()
      const items = page.getByRole('tabpanel', { name: 'Versions' }).getByRole('listitem')
      await items.last().getByRole('button').first().click()
      await page.getByRole('button', { name: 'Restore this version' }).click()
      await page.getByRole('alertdialog').getByRole('button', { name: 'Restore version' }).click()

      await expect(editorOf(otherPage)).toContainText(SAY_TEXT, { timeout: 2_000 })
      await expect(editorOf(otherPage)).not.toContainText('Unwanted edit.')
    } finally {
      await other.close()
    }
  })
})

test.describe('Approved lessons (R23 lock)', () => {
  test('an approved lesson opens read-only with the lock banner', async ({
    page,
    pool,
  }, testInfo) => {
    const { lessonId } = await createLesson(pool, { status: 'approved' })
    await signIn(page, APPROVER_1.email)
    await page.goto(`/lessons/${lessonId}`)
    const doc = page.getByRole('article', { name: 'Lesson 4 editor' })
    await expect(doc).toContainText(SAY_TEXT)
    await expect(page.getByRole('status')).toContainText(
      'This lesson is approved, so editing is locked.',
    )
    await expect(page.getByRole('button', { name: 'Reopen for edits' })).toBeVisible()
    await snap(page, testInfo, 'R23-approved-locked')

    // Nothing editable: no textbox, no add affordances, typing changes nothing.
    await expect(page.getByRole('textbox')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Add a part' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Add .* standard$/ })).toHaveCount(0)
    await doc.getByText(SAY_TEXT).click()
    await page.keyboard.type('Should not appear.')
    await expect(doc).not.toContainText('Should not appear.')
    await expect.poll(() => storedContent(pool, lessonId)).toEqual(richLessonContent())
    expect(await versionCount(pool, lessonId)).toBe(0)
  })

  test('a reviewer sees the lock too, and the hint to ask an approver', async ({ page, pool }) => {
    const { lessonId } = await createLesson(pool, { status: 'approved' })
    await signIn(page, REVIEWER_1.email)
    await page.goto(`/lessons/${lessonId}`)
    await expect(page.getByText('Locked. Ask an approver to reopen.')).toBeVisible()
    await expect(page.getByRole('textbox')).toHaveCount(0)
  })

  test('an editable lesson is a textbox and typing saves', async ({ page, pool }) => {
    const { lessonId } = await createLesson(pool)
    await signIn(page, REVIEWER_1.email)
    await openEditor(page, lessonId)
    await caretIn(page, SAY_TEXT)
    await page.keyboard.type(' Saved.')
    await expect(page.getByText('All changes saved')).toBeVisible()
    await expect
      .poll(
        async () => (await storedContent(pool, lessonId)).body.sections[0]!.parts[0]!.blocks[1],
        {
          timeout: 10_000,
        },
      )
      .toMatchObject({
        type: 'say',
        text: 'Today we meet a narrator who says he is **not** a normal kid. Saved.',
      })
  })
})
