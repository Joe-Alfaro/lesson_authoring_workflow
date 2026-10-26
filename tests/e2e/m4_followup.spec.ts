// M4 validation follow-up: AI assist while a collaborator edits (B2/B3), a 7th editor tab in one
// browser (B1), dialog focus and Escape (D1/D2), the Failed state (D3) and copy fixes (R21, R14,
// R23 history). The model is the fake Anthropic API.
import type pg from 'pg'
import { suggestionCard, selectionToolbar, selectParagraph, fakeLlm } from './assist_support'
import {
  addVersion,
  APPROVER_1,
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
  withSay,
} from './lesson_support'
import { AUTHOR, expect, signIn, test } from './support'
import { richLessonContent } from '../fixtures/lesson/rich_lesson_fixture'

const SUGGESTION = 'A rewritten line from the fake model.'
const CONNECTION_TEXT = 'Remind students of the myth they read in Lesson 3.'

async function launchBlock(pool: pg.Pool, lessonId: string, index: number) {
  const block = (await storedContent(pool, lessonId)).body.sections[0]!.parts[0]!.blocks[index]!
  if (block.type === 'say' || block.type === 'connection') return block.text
  if (block.type === 'ask') return block.question
  return null
}

async function userId(pool: pg.Pool, email: string): Promise<string> {
  const result = await pool.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email])
  return result.rows[0]!.id
}

test.beforeEach(async ({ db }) => {
  expect(await db.count('units')).toBe(0)
  await fakeLlm.reset()
})

test.describe('AI assist while someone else edits (B2, B3)', () => {
  test('pending: an edit before the selection; the suggestion still targets the selected text', async ({
    browser,
    page,
    pool,
  }) => {
    const { lessonId } = await createLesson(pool)
    await signIn(page, REVIEWER_1.email)
    const editor = await openEditor(page, lessonId)
    const other = await signedInPage(browser, REVIEWER_2)
    try {
      await openEditor(other.page, lessonId)
      await fakeLlm.respond({ output: { text: SUGGESTION }, delayMs: 4_000 })
      await selectParagraph(page, ASK_TEXT)
      await selectionToolbar(page).getByRole('button', { name: 'Rewrite' }).click()
      await expect(
        page.getByRole('status').filter({ hasText: 'Writing a suggestion.' }),
      ).toBeVisible()

      // The Say paragraph is above the selected Ask.
      await caretIn(other.page, SAY_TEXT, 'start')
      await other.page.keyboard.type('PREFIX-INSERTED ')
      await expect(editor).toContainText('PREFIX-INSERTED')

      await expect(page.getByLabel('Removed text')).toHaveText(ASK_TEXT)
      await suggestionCard(page).getByRole('button', { name: 'Accept' }).click()
      await expect.poll(() => launchBlock(pool, lessonId, 2), { timeout: 10_000 }).toBe(SUGGESTION)
      expect(await launchBlock(pool, lessonId, 1)).toMatch(/^PREFIX-INSERTED Today we meet/)
    } finally {
      await other.context.close()
    }
  })

  test('suggestion: an edit after the selection keeps the suggestion; accept applies to it', async ({
    browser,
    page,
    pool,
  }) => {
    const { lessonId } = await createLesson(pool)
    await signIn(page, REVIEWER_1.email)
    const editor = await openEditor(page, lessonId)
    const other = await signedInPage(browser, REVIEWER_2)
    try {
      await openEditor(other.page, lessonId)
      await fakeLlm.respond({ output: { text: SUGGESTION } })
      await selectParagraph(page, SAY_TEXT)
      await selectionToolbar(page).getByRole('button', { name: 'Rewrite' }).click()
      const card = suggestionCard(page)
      await expect(card).toBeVisible()

      await caretIn(other.page, CONNECTION_TEXT, 'end')
      await other.page.keyboard.type(' SUFFIX-ADDED')
      await expect(editor).toContainText('SUFFIX-ADDED')

      await expect(card).toBeVisible()
      await expect(page.getByLabel('Suggested text')).toHaveText(SUGGESTION)
      await card.getByRole('button', { name: 'Accept' }).click()
      await expect.poll(() => launchBlock(pool, lessonId, 1), { timeout: 10_000 }).toBe(SUGGESTION)
      expect(await launchBlock(pool, lessonId, 3)).toBe(`${CONNECTION_TEXT} SUFFIX-ADDED`)
    } finally {
      await other.context.close()
    }
  })

  for (const phase of ['pending', 'suggestion'] as const) {
    test(`${phase}: an edit inside the selection drops the suggestion with a message; assist stays usable`, async ({
      browser,
      page,
      pool,
    }) => {
      const { lessonId } = await createLesson(pool)
      await signIn(page, REVIEWER_1.email)
      const editor = await openEditor(page, lessonId)
      const other = await signedInPage(browser, REVIEWER_2)
      try {
        await openEditor(other.page, lessonId)
        await fakeLlm.respond({
          output: { text: SUGGESTION },
          delayMs: phase === 'pending' ? 4_000 : 0,
        })
        await selectParagraph(page, SAY_TEXT)
        await selectionToolbar(page).getByRole('button', { name: 'Rewrite' }).click()
        if (phase === 'pending') {
          await expect(
            page.getByRole('status').filter({ hasText: 'Writing a suggestion.' }),
          ).toBeVisible()
        } else {
          await expect(suggestionCard(page)).toBeVisible()
        }

        await editorOf(other.page).getByText(SAY_TEXT).click()
        await other.page.keyboard.type('ZZ')
        await expect(editor).toContainText('ZZ')

        await expect(page.getByRole('main').getByRole('alert')).toContainText(
          'Someone changed the selected text while the AI was working',
        )
        await expect(suggestionCard(page)).toHaveCount(0)
        if (phase === 'pending') {
          // The late answer is ignored too.
          await page.waitForTimeout(4_500)
          await expect(suggestionCard(page)).toHaveCount(0)
        }
        await expect(page.getByLabel('Removed text')).toHaveCount(0)

        // Assist still works on the next selection.
        await selectParagraph(page, ASK_TEXT)
        await expect(selectionToolbar(page)).toBeVisible()
        await expect.poll(() => launchBlock(pool, lessonId, 1), { timeout: 10_000 }).toContain('ZZ')
        expect(await launchBlock(pool, lessonId, 1)).not.toContain(SUGGESTION)
      } finally {
        await other.context.close()
      }
    })
  }
})

test.describe('Capacity (B1)', () => {
  test('a 7th editor tab in the same browser loads', async ({ browser, pool }) => {
    test.setTimeout(120_000)
    const { lessonId } = await createLesson(pool)
    const { context, page } = await signedInPage(browser, REVIEWER_1)
    try {
      const pages = [page]
      for (let index = 1; index < 7; index += 1) pages.push(await context.newPage())
      for (const tab of pages) await openEditor(tab, lessonId)
      await expect(editorOf(pages[6]!)).toContainText(SAY_TEXT.slice(0, 20))
    } finally {
      await context.close()
    }
  })
})

test.describe('Dialogs keep focus and close with Escape (D1, D2)', () => {
  test('Request changes: Tab stays inside, Escape closes from anywhere, focus returns', async ({
    page,
    pool,
  }) => {
    const { lessonId } = await createLesson(pool, { status: 'in_review' })
    await signIn(page, APPROVER_1.email)
    await openEditor(page, lessonId)
    const trigger = page.getByRole('button', { name: 'Request changes', exact: true })
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: 'Request changes to Lesson 4' })
    for (let index = 0; index < 6; index += 1) {
      await page.keyboard.press('Tab')
      expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true)
    }
    await page.keyboard.press('Shift+Tab')
    expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(trigger).toBeFocused()

    // Escape works even when focus has left the dialog.
    await trigger.click()
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
  })

  test('Regenerate: after an error, Escape closes and focus returns to Regenerate', async ({
    page,
    pool,
  }) => {
    const { lessonId } = await createLesson(pool)
    await signIn(page, REVIEWER_1.email)
    await openEditor(page, lessonId)
    // Nothing is scripted, so the fake API refuses the call and the route answers an error.
    const trigger = page.getByRole('button', { name: 'Regenerate Look Back with AI' })
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: 'Regenerate Look Back' })
    await expect(dialog).toContainText(
      'Uses prompt v1 and this lesson’s outline row, standards and the sections around it.',
    )
    await dialog.getByRole('button', { name: 'Regenerate section' }).click()
    await expect(dialog.getByRole('alert')).toBeVisible()
    expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true)
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(trigger).toBeFocused()
  })
})

test.describe('Failed lessons (D3, R23-workflow-states)', () => {
  test('an author sees Not generated and Retry generation; the lesson is not editable', async ({
    page,
    pool,
  }) => {
    const { lessonId } = await createLesson(pool, { status: 'failed' })
    await signIn(page, AUTHOR.email)
    await page.goto(`/lessons/${lessonId}`)
    await expect(page.getByRole('article', { name: 'Lesson 4 editor' })).toContainText(
      SAY_TEXT.slice(0, 20),
    )
    await expect(page.getByText('Not generated', { exact: true })).toBeVisible()
    await expect(editorOf(page)).toHaveCount(0)
    await page.getByRole('button', { name: 'Retry generation' }).click()
    await expect
      .poll(
        async () =>
          (
            await pool.query<{ n: number }>(
              `SELECT count(*)::int AS n FROM workflow_events WHERE lesson_id = $1 AND to_status = 'generating'`,
              [lessonId],
            )
          ).rows[0]!.n,
        { timeout: 10_000 },
      )
      .toBe(1)
  })

  test('a reviewer sees no Retry generation', async ({ page, pool }) => {
    const { lessonId } = await createLesson(pool, { status: 'failed' })
    await signIn(page, REVIEWER_1.email)
    await page.goto(`/lessons/${lessonId}`)
    await expect(page.getByText('Not generated', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Retry generation' })).toHaveCount(0)
    await expect(editorOf(page)).toHaveCount(0)
  })
})

test.describe('History and versions copy (R23-history, R14)', () => {
  test('assignments show in History; a version edited by two people names both', async ({
    page,
    pool,
  }) => {
    const { lessonId } = await createLesson(pool, { content: withSay('Edited together.') })
    const author = await userId(pool, AUTHOR.email)
    const reviewer3 = await userId(pool, REVIEWER_3.email)
    await pool.query(
      `INSERT INTO assignment_events (lesson_id, assignee_id, actor_id, at) VALUES ($1, $2, $3, now())`,
      [lessonId, reviewer3, author],
    )
    await addVersion(pool, lessonId, richLessonContent(), null, new Date('2026-10-25T10:44:00Z'))
    const edited = await addVersion(
      pool,
      lessonId,
      withSay('Edited together.'),
      REVIEWER_1.email,
      new Date('2026-10-25T13:52:00Z'),
    )
    await pool.query(
      `UPDATE lesson_versions SET contributor_ids = ARRAY[$1]::uuid[] WHERE id = $2`,
      [await userId(pool, REVIEWER_2.email), edited],
    )

    await signIn(page, REVIEWER_1.email)
    await page.goto(`/lessons/${lessonId}`)
    await expect(editorOf(page)).toContainText('Edited together.')
    await page.getByRole('button', { name: 'Version history' }).click()
    const versions = page.getByRole('tabpanel', { name: 'Versions' }).getByRole('listitem')
    await expect(versions.nth(0)).toContainText(
      `${REVIEWER_1.name}, ${REVIEWER_2.name}. Edited Launch`,
    )
    await page.getByRole('tab', { name: 'History' }).click()
    await expect(
      page.getByRole('tabpanel', { name: 'History' }).getByRole('listitem').first(),
    ).toContainText(`Author 01 assigned to ${REVIEWER_3.name}`)
  })
})
