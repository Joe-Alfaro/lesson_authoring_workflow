// M4 re-validation N1/N2 with a GENERATED lesson (the e2e worker's fake model returns content with
// no ids, like the real one): the saved lesson has ids, so Regenerate section works on it before
// anyone edits; and after Retry generation the lesson page follows the status live into the editor.
import type pg from 'pg'
import type { LessonContent } from '../../src/lesson/schema'
import { fakeLlm } from './assist_support'
import { test, expect } from './dashboard_support'
import { generatedTitle } from './fake_llm'
import { editorOf, REVIEWER_1, signedInPage } from './lesson_support'
import { AUTHOR, signIn } from './support'

const PROPOSED_PROMPT = 'Write one sentence that uses a vocabulary word from today.'

async function lessonRow(pool: pg.Pool, lessonId: string) {
  const result = await pool.query<{ status: string; content: LessonContent | null }>(
    'SELECT status, content FROM lessons WHERE id = $1',
    [lessonId],
  )
  return result.rows[0]!
}

test.beforeEach(async () => {
  await fakeLlm.reset()
})

test('a freshly generated lesson has ids, and Regenerate section works before any edit (N1)', async ({
  browser,
  dash,
  page,
  pool,
}) => {
  test.setTimeout(90_000)
  const unit = await dash.importSampleUnit()
  const lessonId = unit.lessonIds.get(4)!
  await signIn(page, AUTHOR.email)
  const started = await page.request.post(`/api/units/${unit.unitId}/generation/regenerate`, {
    data: { lessonIds: [lessonId] },
  })
  expect(started.status()).toBe(201)
  // Imported lessons are Drafts with no content; generation fills the content.
  await expect
    .poll(
      async () => {
        const row = await lessonRow(pool, lessonId)
        return row.status === 'draft' && row.content !== null
      },
      { timeout: 30_000 },
    )
    .toBe(true)

  const generated = (await lessonRow(pool, lessonId)).content!
  const ids = generated.body.sections.flatMap((section) => [
    section.id,
    ...section.parts.flatMap((part) => [part.id, ...part.blocks.map((block) => block.id)]),
  ])
  expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true)
  const lookBack = generated.body.sections.find((section) => section.kind === 'look_back')!

  const reviewer = await signedInPage(browser, REVIEWER_1)
  try {
    await reviewer.page.goto(`/lessons/${lessonId}`)
    await expect(editorOf(reviewer.page)).toContainText(generatedTitle(4))
    await fakeLlm.respond({
      output: {
        section: {
          kind: 'look_back',
          minutes: lookBack.minutes,
          purpose: 'Students will use a vocabulary word to reflect.',
          parts: [
            {
              standards: [],
              blocks: [{ type: 'reflection', prompt: PROPOSED_PROMPT, questions: ['Which word?'] }],
            },
          ],
        },
      },
    })
    await reviewer.page.getByRole('button', { name: 'Regenerate Look Back with AI' }).click()
    await reviewer.page
      .getByRole('dialog', { name: 'Regenerate Look Back' })
      .getByRole('button', { name: 'Regenerate section' })
      .click()
    const proposal = reviewer.page.getByRole('region', { name: 'Proposed Look Back' })
    await expect(proposal).toBeVisible()
    await proposal.getByRole('button', { name: 'Accept' }).click()
    await expect
      .poll(
        async () =>
          (await lessonRow(pool, lessonId)).content!.body.sections.find(
            (section) => section.kind === 'look_back',
          ),
        { timeout: 10_000 },
      )
      .toMatchObject({ id: lookBack.id, parts: [{ blocks: [{ prompt: PROPOSED_PROMPT }] }] })
  } finally {
    await reviewer.context.close()
  }
})

test('after Retry generation the page follows the status into the editor; Retry is disabled meanwhile (N2)', async ({
  dash,
  page,
  pool,
}) => {
  test.setTimeout(90_000)
  const unit = await dash.importSampleUnit()
  const lessonId = unit.lessonIds.get(5)!
  await pool.query(`UPDATE lessons SET status = 'failed' WHERE id = $1`, [lessonId])
  await signIn(page, AUTHOR.email)
  await page.goto(`/lessons/${lessonId}`)
  const retry = page.getByRole('button', { name: 'Retry generation' })
  await expect(page.getByText('Not generated', { exact: true })).toBeVisible()
  await retry.click()
  // While it generates, Retry can't be pressed again.
  await expect(retry.or(editorOf(page, 5))).toBeVisible()
  if (await retry.isVisible()) await expect(retry).toBeDisabled()
  // No reload: the page switches to the editor once the lesson is a Draft.
  await expect(editorOf(page, 5)).toContainText(generatedTitle(5), { timeout: 30_000 })
  expect((await lessonRow(pool, lessonId)).status).toBe('draft')
})
