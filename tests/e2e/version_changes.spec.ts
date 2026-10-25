// R14 version history shows what changed: each version names the areas it changed since the
// previous one, and the read-only preview highlights what differs from the current lesson.
// Mockup: docs/design/lesson-authoring/R14-version-history. Contract: src/assist/README.md (M4).
import type { LessonContent } from '../../src/lesson/schema'
import { richLessonContent } from '../fixtures/lesson/rich_lesson_fixture'
import {
  addVersion,
  createLesson,
  editorOf,
  REVIEWER_1,
  REVIEWER_2,
  withSay,
} from './lesson_support'
import { expect, expectNoAxeViolations, signIn, snap, test } from './support'

function withLookBackPrompt(lesson: LessonContent, prompt: string): LessonContent {
  const reflection = lesson.body.sections[3]!.parts[0]!.blocks[0]!
  if (reflection.type !== 'reflection') throw new Error('fixture changed')
  reflection.prompt = prompt
  return lesson
}

function withRubricTitle(lesson: LessonContent, title: string): LessonContent {
  const rubric = lesson.body.sections[2]!.parts[1]!.blocks[0]!
  if (rubric.type !== 'rubric') throw new Error('fixture changed')
  rubric.title = title
  return lesson
}

test.describe('What changed between versions (R14)', () => {
  test('each version lists the areas it changed since the previous one', async ({
    db,
    page,
    pool,
  }, testInfo) => {
    expect(await db.count('units')).toBe(0)
    const launchEdit = withSay('Edited by Reviewer 02.')
    const laterEdit = withRubricTitle(
      withLookBackPrompt(withSay('Edited by Reviewer 02.'), 'Rate yourself from 1 to 3.'),
      'A new rubric title',
    )
    const { lessonId } = await createLesson(pool, { content: laterEdit })
    await addVersion(pool, lessonId, richLessonContent(), null, new Date('2026-10-25T10:44:00Z'))
    await addVersion(pool, lessonId, launchEdit, REVIEWER_2.email, new Date('2026-10-25T13:52:00Z'))
    await addVersion(pool, lessonId, laterEdit, REVIEWER_1.email, new Date('2026-10-25T14:18:00Z'))

    await signIn(page, REVIEWER_1.email)
    await page.goto(`/lessons/${lessonId}`)
    await expect(editorOf(page)).toContainText('Edited by Reviewer 02.')
    await page.getByRole('button', { name: 'Version history' }).click()
    const items = page.getByRole('tabpanel', { name: 'Versions' }).getByRole('listitem')
    await expect(items).toHaveCount(3)
    await expect(items.nth(0)).toContainText(`${REVIEWER_1.name}. Edited Part B, Look Back`)
    await expect(items.nth(1)).toContainText(`${REVIEWER_2.name}. Edited Launch`)
    await expect(items.nth(2)).toContainText('System. Generated')
    await snap(page, testInfo, 'R14-version-history-changes')
    await expectNoAxeViolations(page)
  })

  test('the preview highlights what differs from the current lesson', async ({
    db,
    page,
    pool,
  }, testInfo) => {
    expect(await db.count('units')).toBe(0)
    const { lessonId } = await createLesson(pool, { content: withSay('The current opening line.') })
    await addVersion(pool, lessonId, richLessonContent(), null, new Date('2026-10-25T10:44:00Z'))

    await signIn(page, REVIEWER_1.email)
    await page.goto(`/lessons/${lessonId}`)
    await expect(editorOf(page)).toContainText('The current opening line.')
    await page.getByRole('button', { name: 'Version history' }).click()
    await page
      .getByRole('tabpanel', { name: 'Versions' })
      .getByRole('listitem')
      .first()
      .getByRole('button')
      .first()
      .click()

    await expect(page.getByText(/Viewing the version from .* by System\./)).toBeVisible()
    await expect(
      page.getByText('Read-only. Highlighted text differs from the current lesson.'),
    ).toBeVisible()
    // The version's own text is highlighted; the current text it replaced is shown struck through.
    await expect(page.getByLabel('Text in this version').first()).toContainText(
      'narrator who says he is',
    )
    await expect(page.getByLabel('Current text').first()).toContainText('The current opening line.')
    // One highlight per changed field; unchanged fields are not highlighted.
    await expect(page.getByLabel('Text in this version')).toHaveCount(1)
    await expect(page.getByLabel('Current text')).toHaveCount(1)
    await snap(page, testInfo, 'R14-version-diff')
  })
})
