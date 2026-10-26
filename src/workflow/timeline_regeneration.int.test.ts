// N5 (M4 re-validation): a failed regeneration that kept the previous content reads as such in
// History, not "generated as Draft".
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { connectTestDb } from '../../tests/db'
import { cleanWorkflowData, createTestUnit, lessonContent } from '../../tests/workflow_fixtures'
import { runMigrations } from '../db/migrate'
import { workflowEvents } from '../db/schema'
import { getLessonTimeline } from './timeline'

describe('timeline: failed regeneration', () => {
  const { pool, db } = connectTestDb()
  beforeAll(async () => {
    await runMigrations(pool)
  })
  beforeEach(async () => {
    await cleanWorkflowData(db)
  })
  afterAll(async () => {
    await cleanWorkflowData(db)
    await pool.end()
  })

  it('reads "regeneration failed; previous content kept as Draft" and keeps the note', async () => {
    const unit = await createTestUnit(db, {
      lessons: [{ lessonNumber: 2, content: lessonContent('Kept') }],
    })
    const lessonId = unit.lessonIds[0]!
    const note = 'Regeneration failed; the previous content was kept. The model timed out.'
    await db.insert(workflowEvents).values([
      {
        lessonId,
        fromStatus: 'draft',
        toStatus: 'generating',
        at: new Date(Date.UTC(2026, 9, 25, 9)),
      },
      {
        lessonId,
        fromStatus: 'generating',
        toStatus: 'draft',
        note,
        at: new Date(Date.UTC(2026, 9, 25, 9, 2)),
      },
    ])
    const timeline = await getLessonTimeline(db, lessonId)
    expect(timeline.map((event) => event.text)).toEqual([
      'started generating',
      'regeneration failed; previous content kept as Draft',
    ])
    expect(timeline[1]!.note).toBe(note)
  })
})
