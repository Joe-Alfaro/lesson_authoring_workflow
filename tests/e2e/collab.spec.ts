// R18 real-time collaboration and R17 editor, two people in two browser contexts.
// Mockup: docs/design/lesson-authoring/R17-lesson-editor.html (presence avatars, remote cursors).
import {
  ASK_TEXT,
  caretIn,
  createLesson,
  editorOf,
  openEditor,
  REVIEWER_1,
  REVIEWER_2,
  REVIEWER_3,
  SAY_TEXT,
  signedInPage,
  storedContent,
} from './lesson_support'
import { expect, snap, test } from './support'

test.describe('Two people editing one lesson (R18)', () => {
  test('each sees the other’s edits within 1 s, and the other’s name and cursor', async ({
    browser,
    db,
    pool,
  }, testInfo) => {
    expect(await db.count('units')).toBe(0)
    const { lessonId } = await createLesson(pool)
    const a = await signedInPage(browser, REVIEWER_1)
    const b = await signedInPage(browser, REVIEWER_2)
    try {
      await openEditor(a.page, lessonId)
      await openEditor(b.page, lessonId)

      // Presence in the lesson bar names the other person.
      await expect(a.page.getByLabel(`Also editing: ${REVIEWER_2.name}`)).toBeVisible()
      await expect(b.page.getByLabel(`Also editing: ${REVIEWER_1.name}`)).toBeVisible()

      await caretIn(a.page, SAY_TEXT)
      await a.page.keyboard.type(' Alpha edit.')
      await expect(editorOf(b.page)).toContainText(`${SAY_TEXT} Alpha edit.`, { timeout: 1_000 })

      await caretIn(b.page, ASK_TEXT)
      await b.page.keyboard.type(' Beta edit.')
      await expect(editorOf(a.page)).toContainText(`${ASK_TEXT} Beta edit.`, { timeout: 1_000 })

      // B's caret is in A's document with B's name on it, and the other way round.
      await expect(editorOf(a.page).getByText(REVIEWER_2.name, { exact: true })).toBeVisible({
        timeout: 1_000,
      })
      await caretIn(a.page, SAY_TEXT)
      await expect(editorOf(b.page).getByText(REVIEWER_1.name, { exact: true })).toBeVisible({
        timeout: 1_000,
      })
      await expect(a.page.getByText('All changes saved')).toBeVisible()
      await snap(a.page, testInfo, 'R17-lesson-editor')
    } finally {
      await a.context.close()
      await b.context.close()
    }
  })

  test('concurrent typing in the same paragraph keeps both people’s text', async ({
    browser,
    pool,
  }) => {
    const { lessonId } = await createLesson(pool)
    const a = await signedInPage(browser, REVIEWER_1)
    const b = await signedInPage(browser, REVIEWER_2)
    try {
      await openEditor(a.page, lessonId)
      await openEditor(b.page, lessonId)
      await caretIn(a.page, SAY_TEXT, 'start')
      await caretIn(b.page, SAY_TEXT, 'end')
      await Promise.all([
        a.page.keyboard.type('From A. ', { delay: 30 }),
        b.page.keyboard.type(' From B.', { delay: 30 }),
      ])
      const merged = `From A. ${SAY_TEXT} From B.`
      await expect(editorOf(a.page)).toContainText(merged, { timeout: 2_000 })
      await expect(editorOf(b.page)).toContainText(merged, { timeout: 2_000 })
    } finally {
      await a.context.close()
      await b.context.close()
    }
  })

  test('after every editor closes, reopening shows the latest content', async ({
    browser,
    pool,
  }) => {
    const { lessonId } = await createLesson(pool)
    const a = await signedInPage(browser, REVIEWER_1)
    const b = await signedInPage(browser, REVIEWER_2)
    await openEditor(a.page, lessonId)
    await openEditor(b.page, lessonId)
    await caretIn(a.page, SAY_TEXT)
    await a.page.keyboard.type(' Kept by A.')
    await caretIn(b.page, ASK_TEXT)
    await b.page.keyboard.type(' Kept by B.')
    await expect(a.page.getByText('All changes saved')).toBeVisible()
    await expect(b.page.getByText('All changes saved')).toBeVisible()
    await a.context.close()
    await b.context.close()

    // The snapshot reaches lessons.content too (the lesson view and dashboard read it).
    await expect
      .poll(async () => JSON.stringify(await storedContent(pool, lessonId)), { timeout: 10_000 })
      .toContain('Kept by B.')

    const c = await signedInPage(browser, REVIEWER_3)
    try {
      const editor = await openEditor(c.page, lessonId)
      await expect(editor).toContainText(`${SAY_TEXT} Kept by A.`)
      await expect(editor).toContainText(`${ASK_TEXT} Kept by B.`)
      await c.page.reload()
      await expect(editorOf(c.page)).toContainText(`${SAY_TEXT} Kept by A.`)
    } finally {
      await c.context.close()
    }
  })
})
