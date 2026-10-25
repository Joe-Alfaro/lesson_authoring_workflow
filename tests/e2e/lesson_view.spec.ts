// R19 read-only lesson view. Mockups: docs/design/lesson-authoring/R19-lesson-view.html and
// R19-lesson-view-mobile.html.
import { createLesson, REVIEWER_1, standardText } from './lesson_support'
import { expect, signIn, snap, test } from './support'

test.describe('Lesson view (R19)', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, REVIEWER_1.email)
  })

  test('renders front matter, the pacing table and the numbered sequence, read-only', async ({
    page,
    pool,
  }, testInfo) => {
    const { lessonId } = await createLesson(pool, { status: 'in_review' })
    await page.goto(`/lessons/${lessonId}/view`)
    const lesson = page.getByRole('article', { name: 'Lesson 4' })
    await expect(
      lesson.getByRole('heading', { level: 1, name: 'Lesson 4: Placeholder Lesson: Every Block' }),
    ).toBeVisible()
    await snap(page, testInfo, 'R19-lesson-view')

    // Front matter.
    await expect(lesson.getByText('Unit 4: Placeholder Unit')).toBeVisible()
    await expect(lesson.getByText('Investigation 1')).toBeVisible()
    await expect(lesson.getByText('Core Reading')).toBeVisible()
    await expect(lesson.getByText('50 min', { exact: true }).first()).toBeVisible()
    for (const term of [
      'Focus standards',
      'Supporting standards',
      'ELD standards',
      'Lesson texts',
      'Vocabulary',
      'Materials',
    ]) {
      await expect(lesson.getByRole('term').filter({ hasText: term })).toBeVisible()
    }
    for (const code of ['RL.6.1', 'RL.6.2', 'L.6.4', 'ELD.PI.6.6']) {
      await expect(lesson.getByRole('button', { name: code, exact: true })).toBeVisible()
    }
    await expect(lesson.getByRole('heading', { name: 'Student learning objectives' })).toBeVisible()
    await expect(lesson.getByRole('heading', { name: 'Essential questions' })).toBeVisible()

    // Pacing table built from the section minutes.
    await expect(lesson.getByRole('heading', { name: 'Lesson pacing' })).toBeVisible()
    const pacing = lesson.getByRole('table').filter({ hasText: 'Lesson flow' })
    await expect(pacing.getByRole('columnheader')).toHaveText([
      'Lesson flow',
      'Purpose of learning experience',
    ])
    await expect(pacing.getByRole('row')).toHaveCount(5)
    for (const flow of [
      'Launch, 5 min',
      'Literacy Lab, 10 min',
      'Learning in Action, 30 min',
      'Look Back, 5 min',
    ]) {
      await expect(pacing.getByRole('cell', { name: flow })).toBeVisible()
    }
    await expect(lesson.getByText('Total 50 of 50 minutes.')).toBeVisible()

    // Numbered sequence; Homework is unnumbered.
    await expect(lesson.getByRole('heading', { level: 2 }).filter({ hasText: /^\d / })).toHaveText([
      /^1 Launch/,
      /^2 Literacy Lab/,
      /^3 Learning in Action/,
      /^4 Look Back/,
    ])
    await expect(lesson.getByRole('heading', { level: 2, name: 'Homework' })).toBeVisible()
    await expect(
      lesson.getByRole('heading', {
        level: 3,
        name: /Part A: Reading the opening with pause points/,
      }),
    ).toBeVisible()

    // Teacher-facing inline labels and boxes, expanded.
    await expect(lesson.getByText('Say:').first()).toBeVisible()
    await expect(lesson.getByText('Ask:').first()).toBeVisible()
    await expect(lesson.getByText('Exemplar response').first()).toBeVisible()
    await expect(lesson.getByLabel('Option B, correct')).toBeVisible()
    await expect(lesson.getByText('Integrated ELD instructions')).toBeVisible()
    await expect(
      lesson.getByText('Support students in naming the narrator’s feelings.'),
    ).toBeVisible()

    // Read-only: nothing to type into; the bar offers the HTML download and the editor.
    await expect(page.getByRole('textbox')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'HTML' })).toBeVisible()
    await page.getByRole('link', { name: 'Open editor' }).click()
    await expect(page).toHaveURL(new RegExp(`/lessons/${lessonId}$`))
  })

  test('at 390 wide the front matter stacks and a chip row jumps between sections', async ({
    page,
    pool,
  }, testInfo) => {
    const { lessonId } = await createLesson(pool)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/lessons/${lessonId}/view`)
    await expect(page.getByRole('heading', { level: 1, name: /Lesson 4/ })).toBeVisible()
    await snap(page, testInfo, 'R19-lesson-view-mobile')
    const jump = page.getByRole('navigation', { name: 'Sections' })
    await jump.getByRole('link', { name: /Look Back/ }).click()
    await expect(page.getByRole('heading', { level: 2, name: /Look Back/ })).toBeInViewport()
  })

  test('hovering or focusing a standard code shows its full text (R15)', async ({ page, pool }) => {
    const { lessonId } = await createLesson(pool)
    await page.goto(`/lessons/${lessonId}/view`)
    const chip = page.getByRole('button', { name: 'RL.6.1', exact: true }).first()
    await chip.hover()
    const tooltip = page.getByRole('tooltip')
    await expect(tooltip).toContainText('RL.6.1')
    await expect(tooltip).toContainText(standardText('RL.6.1'))
    await expect(chip).toHaveAttribute('aria-describedby', (await tooltip.getAttribute('id'))!)

    await page.mouse.move(0, 0)
    await expect(tooltip).toBeHidden()
    await chip.focus()
    await expect(page.getByRole('tooltip')).toContainText(standardText('RL.6.1'))
    await page.keyboard.press('Escape')
    await expect(page.getByRole('tooltip')).toBeHidden()
  })
})
