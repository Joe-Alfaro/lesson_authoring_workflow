// R10 prompt editor: system instructions, style guide and per-type guidance; saving creates a
// version, earlier versions stay viewable (read-only), and each lesson shows the version it was
// generated with. Mockups: docs/design/lesson-authoring/R10-prompt-editor.html and
// R10-prompt-version.html; the lesson bar's "Prompt v3, Haiku-class" in every editor mockup.
import type { Page } from '@playwright/test'
import { DEFAULT_PROMPT_TEMPLATE } from '../../src/generation/prompt_template'
import {
  DashboardDb,
  LESSON_COST_USD,
  expect,
  lessonRow,
  openUnit,
  range,
  seededTitle,
  test,
  type SampleUnit,
} from './dashboard_support'
import { expectNoAxeViolations, signIn, snap } from './support'

const TYPE_TABS = [
  'Spark',
  'Core Reading',
  'Core Writing',
  'Academic Discussion',
  'Writing',
  'Flex day',
]

async function openPromptEditor(page: Page, unit: SampleUnit): Promise<void> {
  await openUnit(page, unit)
  await page.getByRole('link', { name: 'Edit prompt' }).click()
  await expect(
    page.getByRole('heading', { level: 1, name: `Prompt for ${unit.heading}` }),
  ).toBeVisible()
}

function versions(page: Page) {
  return page.getByRole('navigation', { name: 'Prompt versions' })
}

/** v1 generated lessons 9 and 14; v2 (current) generated the other 39. */
async function seedTwoVersions(dash: DashboardDb, unit: SampleUnit): Promise<void> {
  const v1 = await dash.currentPromptVersion(unit.unitId)
  const first = await dash.createRun(unit.unitId, {
    status: 'completed',
    capUsd: 5,
    costUsd: 2 * LESSON_COST_USD,
    promptVersionId: v1.id,
    finished: true,
  })
  for (const n of [9, 14]) {
    await dash.setJob(unit, first, n, 'generated')
  }
  const v2 = await dash.savePromptVersion(unit.unitId, 'Second version of the system instructions.')
  const second = await dash.createRun(unit.unitId, {
    status: 'completed',
    capUsd: 5,
    costUsd: 39 * LESSON_COST_USD,
    promptVersionId: v2.id,
    finished: true,
  })
  for (const n of range(1, 41).filter((n) => n !== 9 && n !== 14)) {
    await dash.setJob(unit, second, n, 'generated')
  }
}

test.describe('Prompt editor (R10)', () => {
  test('shows the template in three parts, the version list and what is added automatically', async ({
    page,
    dash,
  }) => {
    const unit = await dash.importSampleUnit()
    await signIn(page)
    await openPromptEditor(page, unit)

    await expect(
      page.getByText('Used for every lesson generated or regenerated in this unit.'),
    ).toBeVisible()
    await expect(
      page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Prompts' }),
    ).toHaveAttribute('aria-current', 'page')

    const system = page.getByRole('textbox', { name: 'System instructions' })
    await expect(system).toHaveAttribute('aria-multiline', 'true')
    await expect(system).toContainText(DEFAULT_PROMPT_TEMPLATE.system.split('\n')[0]!)
    await expect(page.getByRole('textbox', { name: 'Style guide' })).toBeEditable()

    await expect(page.getByRole('tab')).toHaveText(TYPE_TABS)
    await page.getByRole('tab', { name: 'Core Writing' }).click()
    await expect(page.getByRole('tab', { name: 'Core Writing' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(page.getByRole('textbox', { name: 'Core Writing guidance' })).toContainText(
      DEFAULT_PROMPT_TEMPLATE.typeGuidance.core_writing!.split('\n')[0]!,
    )

    const list = versions(page)
    await expect(list.getByRole('link', { name: /^v1\b/ })).toContainText('Current')
    await expect(list.getByRole('link', { name: /^v1\b/ })).toContainText('Used by 0 lessons.')

    const automatic = page.getByRole('heading', { name: 'Added to every lesson automatically' })
    await expect(automatic).toBeVisible()
    for (const item of [
      "The lesson's outline row: type, description, texts, homework, vocabulary",
      'Full text of every focus and supporting standard',
      "ELD standards from the outline, and the ELD file's fields when they aren't empty",
      "The arc's description",
      'The previous and next lesson descriptions',
    ]) {
      await expect(page.getByText(item, { exact: true })).toBeVisible()
    }
    // Nothing to save until something changes.
    await expect(page.getByRole('button', { name: 'Save as v2' })).toBeDisabled()
  })

  test('saving edits to the system instructions and one type guidance creates the next version', async ({
    page,
    dash,
  }, testInfo) => {
    const unit = await dash.importSampleUnit()
    await signIn(page)
    await openPromptEditor(page, unit)

    const system = page.getByRole('textbox', { name: 'System instructions' })
    await system.fill('Write short, teacher-facing grade 6 lessons. Test edit one.')
    await page.getByRole('tab', { name: 'Core Writing' }).click()
    await page
      .getByRole('textbox', { name: 'Core Writing guidance' })
      .fill('Model a paragraph, then give the writing task. Test edit two.')

    await expect(
      page.getByText('Saving creates v2. Lessons already generated keep the version they used.'),
    ).toBeVisible()
    const draft = versions(page).getByRole('link', { name: /^Draft\b/ })
    await expect(draft).toContainText('Unsaved changes')
    await expect(draft).toHaveAttribute('aria-current', 'true')
    await expect(page.getByRole('button', { name: 'Discard changes' })).toBeVisible()
    await snap(page, testInfo, 'R10-prompt-editor')
    await expectNoAxeViolations(page)

    await page.getByRole('button', { name: 'Save as v2' }).click()
    await expect(versions(page).getByRole('link', { name: /^v2\b/ })).toContainText('Current')
    await expect(versions(page).getByRole('link', { name: /^v2\b/ })).toContainText('Author 01')
    await expect(versions(page).getByRole('link', { name: /^v1\b/ })).not.toContainText('Current')
    await expect(versions(page).getByRole('link', { name: /^Draft\b/ })).toHaveCount(0)

    const saved = await dash.promptVersions(unit.unitId)
    expect(saved.map((row) => row.version)).toEqual([1, 2])
    const template = JSON.parse(saved[1]!.template) as typeof DEFAULT_PROMPT_TEMPLATE
    expect(template.system).toBe('Write short, teacher-facing grade 6 lessons. Test edit one.')
    expect(template.typeGuidance.core_writing).toBe(
      'Model a paragraph, then give the writing task. Test edit two.',
    )
    expect(template.styleGuide).toBe(DEFAULT_PROMPT_TEMPLATE.styleGuide)
    expect(template.typeGuidance.core_reading).toBe(
      DEFAULT_PROMPT_TEMPLATE.typeGuidance.core_reading,
    )

    // The new version is what the next run uses.
    await page.goto(`/units/${unit.unitId}`)
    await page.getByRole('button', { name: 'Generate lessons...' }).click()
    await expect(page.getByRole('dialog', { name: 'Generate lessons' })).toContainText('v2')
  })

  test('Discard changes reverts the edits and saves nothing', async ({ page, dash }) => {
    const unit = await dash.importSampleUnit()
    await signIn(page)
    await openPromptEditor(page, unit)
    const system = page.getByRole('textbox', { name: 'System instructions' })
    await system.fill('An edit to throw away.')
    await page.getByRole('button', { name: 'Discard changes' }).click()
    await expect(system).toContainText(DEFAULT_PROMPT_TEMPLATE.system.split('\n')[0]!)
    await expect(versions(page).getByRole('link', { name: /^Draft\b/ })).toHaveCount(0)
    expect((await dash.promptVersions(unit.unitId)).map((row) => row.version)).toEqual([1])
  })

  test('an earlier version is read-only and names the lessons generated with it', async ({
    page,
    dash,
  }, testInfo) => {
    const unit = await dash.importSampleUnit()
    await seedTwoVersions(dash, unit)
    await signIn(page)
    await openPromptEditor(page, unit)

    const list = versions(page)
    await expect(list.getByRole('link', { name: /^v2\b/ })).toContainText('Used by 39 lessons.')
    await expect(list.getByRole('link', { name: /^v1\b/ })).toContainText('Used by 2 lessons.')
    await list.getByRole('link', { name: /^v1\b/ }).click()

    await expect(list.getByRole('link', { name: /^v1\b/ })).toHaveAttribute('aria-current', 'true')
    await expect(
      page.getByText(
        "You're viewing v1. It's read-only. Lessons 9 and 14 were generated with it. Regenerating them uses the current version, v2.",
      ),
    ).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'System instructions' })).toContainText(
      DEFAULT_PROMPT_TEMPLATE.system.split('\n')[0]!,
    )
    await expect(page.getByRole('textbox', { name: 'System instructions' })).not.toBeEditable()
    await expect(page.getByRole('textbox', { name: 'Style guide' })).not.toBeEditable()
    await expect(page.getByRole('button', { name: /^Save as/ })).toHaveCount(0)
    await snap(page, testInfo, 'R10-prompt-version')

    await page.getByRole('link', { name: 'Back to current version' }).click()
    await expect(page.getByRole('textbox', { name: 'System instructions' })).toContainText(
      'Second version of the system instructions.',
    )
    await expect(page.getByRole('textbox', { name: 'System instructions' })).toBeEditable()
  })

  test('each lesson shows the prompt version and model it was generated with', async ({
    page,
    dash,
  }) => {
    const unit = await dash.importSampleUnit()
    await seedTwoVersions(dash, unit)
    await signIn(page)

    await openUnit(page, unit)
    await lessonRow(page, 9)
      .getByRole('link', { name: seededTitle(9) })
      .click()
    await expect(page.getByText('Prompt v1, Haiku-class')).toBeVisible()

    await openUnit(page, unit)
    await lessonRow(page, 10)
      .getByRole('link', { name: seededTitle(10) })
      .click()
    await expect(page.getByText('Prompt v2, Haiku-class')).toBeVisible()
  })
})
