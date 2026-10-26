// N4 (M4 re-validation): on a lesson saved by generation (the model sends no ids), the alignment
// check still sends ids to the model and keeps the evidence it cites.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { connectTestDb } from '../../tests/db'
import { createFakeLlm, TEST_MODEL, TEST_PRICES } from '../../tests/fake_llm'
import { coreLessonContent } from '../../tests/fixtures/lesson/lesson_fixture'
import {
  cleanWorkflowData,
  createTestUnit,
  createUsers,
  type FixtureUsers,
} from '../../tests/workflow_fixtures'
import { runMigrations } from '../db/migrate'
import { normalizeLessonContent } from '../generation/post_process'
import { checkAlignment } from './service'

describe('alignment on a generated lesson (R22)', () => {
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

  it('the request carries ids and evidence on a part or block is kept', async () => {
    const saved = normalizeLessonContent(coreLessonContent(), { pulseCheckCorrectOption: 'B' })
    const unit = await createTestUnit(db, {
      lessons: [{ lessonNumber: 4, status: 'draft', content: saved }],
    })
    const action = saved.body.sections.find((section) => section.kind === 'learning_in_action')!
    const part = action.parts[0]!
    const block = part.blocks[0]!
    const focus = saved.frontMatter.focusStandards
    const llm = createFakeLlm({
      respond: () => ({
        standards: focus.map((code) => ({
          code,
          verdict: 'addressed',
          reason: 'Cited.',
          evidence: [part.id, block.id],
        })),
      }),
    })
    const result = await checkAlignment(
      { db, llm, model: TEST_MODEL, prices: TEST_PRICES, globalCapUsd: 100 },
      { lessonId: unit.lessonIds[0]!, actor: people.reviewer },
    )
    expect(llm.calls[0]!.request.prompt).toContain(`"id":"${part.id}"`)
    expect(result.standards[0]!.evidence.map((item) => item.id)).toEqual([part.id, block.id])
  })
})
