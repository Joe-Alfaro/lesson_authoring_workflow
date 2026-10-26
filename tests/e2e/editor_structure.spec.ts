// M3 validation fixes (R17, R15, Yjs size): add and remove list items, blocks and parts through
// the editor UI, see which field blocks saving, name and tag a new part, and keep the stored Yjs
// document small after structural edits. Uses the rich fixture (tests/fixtures/lesson).
import type pg from 'pg'
import { richLessonContent } from '../fixtures/lesson/rich_lesson_fixture'
import {
  caretIn,
  createLesson,
  editorOf,
  openEditor,
  REVIEWER_1,
  standardText,
  storedContent,
} from './lesson_support'
import { expect, signIn, test } from './support'

async function storedYjsBytes(pool: pg.Pool, lessonId: string): Promise<number> {
  const result = await pool.query<{ n: number }>(
    'SELECT octet_length(state) AS n FROM yjs_documents WHERE name = $1',
    [`lesson:${lessonId}`],
  )
  return Number(result.rows[0]?.n ?? 0)
}

test.describe('Editing the lesson structure through the UI (R17)', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, REVIEWER_1.email)
  })

  test('adds a list item with Enter and removes items with Backspace and the remove control', async ({
    page,
    pool,
  }) => {
    const { lessonId } = await createLesson(pool)
    await openEditor(page, lessonId)
    await caretIn(page, 'Mark two places where the tone changes.')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Bring the book back.')
    await expect
      .poll(async () => (await storedContent(pool, lessonId)).body.homework?.tasks, {
        timeout: 10_000,
      })
      .toEqual([
        'Read and annotate pp. 9–15.',
        'Mark two places where the tone changes.',
        'Bring the book back.',
      ])

    // An empty item goes away with Backspace.
    await page.keyboard.press('Enter')
    await page.keyboard.press('Backspace')
    await page.keyboard.type(' Today.')
    await expect
      .poll(async () => (await storedContent(pool, lessonId)).body.homework?.tasks?.[2], {
        timeout: 10_000,
      })
      .toBe('Bring the book back. Today.')

    // The remove control on an item.
    const item = editorOf(page).getByRole('listitem').filter({ hasText: 'Bring the book back.' })
    await item.hover()
    await item.getByRole('button', { name: 'Remove item' }).click()
    await expect
      .poll(async () => (await storedContent(pool, lessonId)).body.homework?.tasks, {
        timeout: 10_000,
      })
      .toEqual(['Read and annotate pp. 9–15.', 'Mark two places where the tone changes.'])
  })

  test('a new block gets the caret; until it is filled in the bar says which field blocks saving', async ({
    page,
    pool,
  }) => {
    const { lessonId } = await createLesson(pool)
    await openEditor(page, lessonId)
    await editorOf(page)
      .getByRole('button', { name: /^Add a block/ })
      .first()
      .click()
    await page.getByRole('menuitem', { name: 'Say' }).click()

    const blocked = page.getByRole('button', { name: /Not saved: Launch: Say is empty/ })
    await expect(blocked).toBeVisible()
    await expect(page.getByText('All changes saved')).toHaveCount(0)

    // The caret is already in the new Say block.
    await page.keyboard.type('Partners, find your seats.')
    await expect(blocked).toHaveCount(0)
    await expect(page.getByText('All changes saved')).toBeVisible()
    await expect
      .poll(
        async () =>
          (await storedContent(pool, lessonId)).body.sections[0]!.parts[0]!.blocks.map((block) =>
            block.type === 'say' ? block.text : block.type,
          ),
        { timeout: 10_000 },
      )
      .toContain('Partners, find your seats.')

    // Removing a block.
    const connection = editorOf(page).getByRole('button', { name: 'Remove Connection block' })
    await connection.click()
    await expect
      .poll(async () =>
        (await storedContent(pool, lessonId)).body.sections[0]!.parts[0]!.blocks.map((b) => b.type),
      )
      .not.toContain('connection')
  })

  test('the blocked-save button puts the caret in the empty field', async ({ page, pool }) => {
    const { lessonId } = await createLesson(pool)
    await openEditor(page, lessonId)
    await editorOf(page)
      .getByRole('button', { name: /^Add a block/ })
      .first()
      .click()
    await page.getByRole('menuitem', { name: 'Say' }).click()
    await caretIn(page, 'What might a story about a problem kid be about?')
    await page.getByRole('button', { name: /Not saved: Launch: Say is empty/ }).click()
    await page.keyboard.type('Back in the empty field.')
    await expect(page.getByText('All changes saved')).toBeVisible()
  })

  test('a new part gets a label, a title to type, minutes and standards; and can be removed', async ({
    page,
    pool,
  }) => {
    const { lessonId } = await createLesson(pool)
    await openEditor(page, lessonId)
    await editorOf(page).getByRole('button', { name: 'Add a part' }).click()

    // The caret is in the new part's title.
    await page.keyboard.type('Sharing inferences')
    // Fill the new part's empty Teacher note: the blocked-save button leads there.
    await page.getByRole('button', { name: /Not saved:/ }).click()
    await page.keyboard.type('Partners share their best inference.')

    await page.getByRole('spinbutton', { name: 'Minutes for Part C' }).fill('8')
    await page.getByRole('spinbutton', { name: 'Minutes for Part C' }).press('Tab')
    await page.getByRole('button', { name: 'Add a standard to Part C' }).click()
    await page.getByRole('combobox', { name: 'Find a standard' }).fill('RL.6.3')
    await page.getByRole('listbox').getByRole('option').first().click()

    await expect
      .poll(
        async () => {
          const action = (await storedContent(pool, lessonId)).body.sections[2]!
          return action.parts[2]
        },
        { timeout: 10_000 },
      )
      .toMatchObject({
        label: 'C',
        title: 'Sharing inferences',
        minutes: 8,
        standards: ['RL.6.3'],
        blocks: [{ type: 'paragraph', text: 'Partners share their best inference.' }],
      })

    await editorOf(page).getByRole('button', { name: 'Remove part' }).last().click()
    await expect
      .poll(async () => (await storedContent(pool, lessonId)).body.sections[2]!.parts.length, {
        timeout: 10_000,
      })
      .toBe(2)
  })

  test('the stored Yjs document stays near the lesson size after structural edits', async ({
    page,
    pool,
  }) => {
    const { lessonId } = await createLesson(pool)
    await openEditor(page, lessonId)
    await expect.poll(() => storedYjsBytes(pool, lessonId)).toBeGreaterThan(0)
    const start = await storedYjsBytes(pool, lessonId)

    for (let round = 0; round < 3; round += 1) {
      await page.getByRole('button', { name: 'Add supporting standard' }).click()
      await page.getByRole('combobox', { name: 'Find a standard' }).fill('RL.6.3')
      await page.getByRole('listbox').getByRole('option').first().click()
      await page.getByRole('button', { name: 'Remove RL.6.3' }).click()
      await editorOf(page).getByRole('button', { name: 'Add a part' }).click()
      await editorOf(page).getByRole('button', { name: 'Remove part' }).last().click()
    }
    await expect(page.getByText('All changes saved')).toBeVisible()
    await expect.poll(() => storedYjsBytes(pool, lessonId), { timeout: 10_000 }).not.toBe(start)
    // Twelve structural edits: a few KB, not megabytes (y-tiptap 3.0.10 added ~1.5 MB per edit).
    expect(await storedYjsBytes(pool, lessonId)).toBeLessThan(start + 64 * 1024)
  })
})

test.describe('Labels and standard codes in the lesson body (R15)', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, REVIEWER_1.email)
  })

  function generatedStyle() {
    const lesson = richLessonContent()
    lesson.frontMatter.unitTitle = 'Unit 4: Placeholder Unit'
    lesson.body.sections[2]!.parts[0]!.label = 'Part A'
    return lesson
  }

  test('generated labels are not repeated ("Part A", "Unit 4:")', async ({ page, pool }) => {
    const { lessonId } = await createLesson(pool, { content: generatedStyle() })
    await openEditor(page, lessonId)
    const editor = editorOf(page)
    await expect(editor).toContainText('Unit 4: Placeholder Unit')
    await expect(editor).not.toContainText('Unit 4: Unit 4:')
    await expect(editor).not.toContainText('Part Part')
    await expect(page.getByRole('navigation', { name: 'Lesson outline' })).not.toContainText(
      'Part Part',
    )

    await page.goto(`/lessons/${lessonId}/view`)
    const view = page.getByRole('article', { name: 'Lesson 4' })
    await expect(
      view.getByRole('heading', { level: 3, name: /^Part A: Reading the opening/ }),
    ).toBeVisible()
    await expect(view).not.toContainText('Part Part')
    await expect(view).not.toContainText('Unit 4: Unit 4:')
  })

  test('part tags show the standard’s full text and strand name', async ({ page, pool }) => {
    const { lessonId } = await createLesson(pool)
    for (const path of [`/lessons/${lessonId}`, `/lessons/${lessonId}/view`]) {
      await page.goto(path)
      const tag = page.getByRole('button', { name: 'Standard L.6.4' }).first()
      await tag.hover()
      const tooltip = page.getByRole('tooltip')
      await expect(tooltip).toContainText(standardText('L.6.4'))
      await expect(tooltip).toContainText('Language, grade 6')
      await page.mouse.move(0, 0)
    }
    await page.goto(`/lessons/${lessonId}`)
    await page.getByRole('button', { name: 'RL.6.1', exact: true }).first().hover()
    await expect(page.getByRole('tooltip')).toContainText(
      'Reading Standards for Literature, grade 6',
    )
  })
})
