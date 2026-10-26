// M4 validation copy fixes: the editor's History timeline (R23-history) includes assignments and
// says which prompt and model generated the lesson; the Versions list (R14-version-history) says
// "Generated with prompt vN" and names everyone who edited a version.
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { connectTestDb } from '../../tests/db'
import {
  cleanWorkflowData,
  createTestUnit,
  createUsers,
  lessonContent,
  type FixtureUsers,
} from '../../tests/workflow_fixtures'
import { runMigrations } from '../db/migrate'
import { generationJobs, generationRuns, lessonVersions, workflowEvents } from '../db/schema'
import { getCurrentPromptVersion } from '../generation/prompt_versions'
import { assignLessons } from './assignment'
import { getLessonTimeline } from './timeline'
import { listVersions, saveIdleVersion } from './versions'

const AT = (minute: number) => new Date(Date.UTC(2026, 9, 25, 10, minute))

describe('timeline and version provenance', () => {
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

  async function lesson(status: 'draft' | 'in_review' = 'draft') {
    const unit = await createTestUnit(db, {
      lessons: [{ lessonNumber: 4, status, content: lessonContent('L4') }],
    })
    return { unitId: unit.unitId, lessonId: unit.lessonIds[0]! }
  }

  /** A generated job for the lesson, finished at `at`, on prompt v1 of the unit. */
  async function generatedJob(unitId: string, lessonId: string, at: Date) {
    const prompt = await getCurrentPromptVersion(db, unitId)
    const [run] = await db
      .insert(generationRuns)
      .values({
        unitId,
        model: 'claude-haiku-5-5',
        promptVersionId: prompt.id,
        capUsd: 1,
        status: 'completed',
      })
      .returning({ id: generationRuns.id })
    await db
      .insert(generationJobs)
      .values({ runId: run!.id, lessonId, status: 'generated', updatedAt: at })
    return prompt.version
  }

  it('records assignments (who, to whom, when) and lists them in the timeline', async () => {
    const { lessonId } = await lesson()
    await assignLessons(db, {
      lessonIds: [lessonId],
      assigneeId: people.reviewer.id,
      actorId: people.author.id,
    })
    // Same assignee again: nothing changes, nothing is recorded.
    await assignLessons(db, {
      lessonIds: [lessonId],
      assigneeId: people.reviewer.id,
      actorId: people.author.id,
    })
    await assignLessons(db, {
      lessonIds: [lessonId],
      assigneeId: null,
      actorId: people.approver.id,
    })

    const timeline = await getLessonTimeline(db, lessonId)
    expect(timeline.map((event) => [event.actor?.name ?? 'System', event.text])).toEqual([
      [people.author.name, `assigned to ${people.reviewer.name}`],
      [people.approver.name, 'unassigned the lesson'],
    ])
    expect(timeline[0]).toMatchObject({ kind: 'assignment', at: expect.any(Date) })
  })

  it('merges status events and assignments in time order, with the generation prompt and model', async () => {
    const { unitId, lessonId } = await lesson('in_review')
    const version = await generatedJob(unitId, lessonId, AT(44))
    await db.insert(workflowEvents).values([
      { lessonId, fromStatus: null, toStatus: 'generating', at: AT(30) },
      { lessonId, fromStatus: 'generating', toStatus: 'draft', at: AT(44) },
      {
        lessonId,
        fromStatus: 'draft',
        toStatus: 'in_review',
        actorId: people.reviewer.id,
        at: AT(50),
      },
    ])
    await assignLessons(db, {
      lessonIds: [lessonId],
      assigneeId: people.reviewer.id,
      actorId: people.author.id,
    })

    const timeline = await getLessonTimeline(db, lessonId)
    expect(
      timeline.map((event) => [event.kind, event.actor?.name ?? 'System', event.text]),
    ).toEqual([
      ['status', 'System', 'started generating'],
      ['status', 'System', `generated as Draft with prompt v${version}, Haiku-class`],
      ['status', people.reviewer.name, 'submitted for review'],
      ['assignment', people.author.name, `assigned to ${people.reviewer.name}`],
    ])
  })

  it('versions: "prompt vN" on generated versions and every contributor on edited ones', async () => {
    const { unitId, lessonId } = await lesson()
    const version = await generatedJob(unitId, lessonId, AT(44))
    await db.insert(lessonVersions).values([
      { lessonId, content: lessonContent('L4'), createdAt: AT(44) },
      // An older generated version with no job near it: no prompt is claimed.
      { lessonId, content: lessonContent('L4'), createdAt: AT(1) },
    ])
    // Two people edited before the idle version was saved.
    const { lessons } = await import('../db/schema')
    await db
      .update(lessons)
      .set({ content: lessonContent('Edited') })
      .where(eq(lessons.id, lessonId))
    await saveIdleVersion(db, {
      lessonId,
      userId: people.reviewer.id,
      contributorIds: [people.reviewer2.id, people.reviewer.id],
    })

    const versions = await listVersions(db, lessonId)
    expect(versions).toHaveLength(3)
    const [edited, generated, older] = versions
    expect(edited!.author?.name).toBe(people.reviewer.name)
    expect(edited!.contributors).toEqual([{ id: people.reviewer2.id, name: people.reviewer2.name }])
    expect(generated!.author).toBeNull()
    expect(generated!.generatedWith).toBe(`prompt v${version}`)
    expect(older!.generatedWith).toBeUndefined()
  })
})
