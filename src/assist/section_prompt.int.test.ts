// R21 copy (M4 validation): "Uses prompt vN and this lesson's outline row, standards and the
// sections around it." The section request really carries the unit's current prompt version and
// the lesson's outline row. Fake LLM only.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { connectTestDb } from '../../tests/db'
import { createFakeLlm, TEST_MODEL, TEST_PRICES } from '../../tests/fake_llm'
import { richLessonContent } from '../../tests/fixtures/lesson/rich_lesson_fixture'
import {
  cleanWorkflowData,
  createTestUnit,
  createUsers,
  type FixtureUsers,
} from '../../tests/workflow_fixtures'
import { runMigrations } from '../db/migrate'
import { getCurrentPromptVersion, savePromptVersion } from '../generation/prompt_versions'
import { regenerateSection } from './service'

const OUTLINE_LINE =
  'Students meet the narrator and infer how adults see him (outline marker 7731).'

describe('regenerateSection prompt context (R21)', () => {
  const { pool, db } = connectTestDb()
  let people: FixtureUsers

  beforeAll(async () => {
    await runMigrations(pool)
  })
  beforeEach(async () => {
    await cleanWorkflowData(db)
    people = await createUsers(db)
  })
  afterAll(async () => {
    await cleanWorkflowData(db)
    await pool.end()
  })

  it("uses the unit's current prompt version and the lesson's outline row", async () => {
    const unit = await createTestUnit(db, {
      lessons: [
        {
          lessonNumber: 4,
          status: 'draft',
          content: richLessonContent(),
          description: OUTLINE_LINE,
        },
      ],
    })
    const current = await getCurrentPromptVersion(db, unit.unitId)
    const marker = 'Prompt version marker: write for a teacher with ten minutes to prepare.'
    await savePromptVersion(db, {
      unitId: unit.unitId,
      template: { ...current.template, system: `${current.template.system}\n${marker}` },
    })

    const llm = createFakeLlm({
      respond: () => ({ section: richLessonContent().body.sections[3] }),
    })
    await regenerateSection(
      { db, llm, model: TEST_MODEL, prices: TEST_PRICES, globalCapUsd: 100 },
      { lessonId: unit.lessonIds[0]!, actor: people.reviewer, sectionId: 'sec-lookback' },
    )
    const request = llm.calls[0]!.request
    const text = `${request.system}\n${request.prompt}`
    expect(text).toContain(marker)
    expect(text).toContain(OUTLINE_LINE)
    expect(text).toContain('Rate yourself from 1 to 5.')
  })
})
