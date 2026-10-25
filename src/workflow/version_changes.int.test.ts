// R14 "what changed": listVersions itemises each version against the one before it (mockup
// R14-version-history). Contract: src/assist/README.md (M4 additions to src/workflow).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { connectTestDb } from '../../tests/db'
import { richLessonContent } from '../../tests/fixtures/lesson/rich_lesson_fixture'
import {
  cleanWorkflowData,
  createTestUnit,
  createUsers,
  type FixtureUsers,
} from '../../tests/workflow_fixtures'
import { runMigrations } from '../db/migrate'
import { lessonVersions } from '../db/schema'
import type { LessonContent } from '../lesson/schema'
import { listVersions } from './versions'

function withLaunchSay(lesson: LessonContent, text: string): LessonContent {
  const say = lesson.body.sections[0]!.parts[0]!.blocks[1]!
  if (say.type !== 'say') throw new Error('fixture changed')
  say.text = text
  return lesson
}

function withLookBackPrompt(lesson: LessonContent, prompt: string): LessonContent {
  const reflection = lesson.body.sections[3]!.parts[0]!.blocks[0]!
  if (reflection.type !== 'reflection') throw new Error('fixture changed')
  reflection.prompt = prompt
  return lesson
}

describe('listVersions changes (R14)', () => {
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

  it('names the areas each version changed compared with the previous one', async () => {
    const generated = richLessonContent()
    const launchEdit = withLaunchSay(richLessonContent(), 'A new opening line.')
    const lookBackEdit = withLookBackPrompt(
      withLaunchSay(richLessonContent(), 'A new opening line.'),
      'Rate yourself from 1 to 3.',
    )
    const unit = await createTestUnit(db, {
      lessons: [{ lessonNumber: 4, status: 'draft', content: lookBackEdit }],
    })
    const lessonId = unit.lessonIds[0]!
    await db.insert(lessonVersions).values([
      { lessonId, content: generated, createdAt: new Date('2026-10-25T10:44:00Z') },
      {
        lessonId,
        content: launchEdit,
        authorId: people.reviewer.id,
        createdAt: new Date('2026-10-25T13:52:00Z'),
      },
      {
        lessonId,
        content: lookBackEdit,
        authorId: people.reviewer2.id,
        createdAt: new Date('2026-10-25T14:18:00Z'),
      },
      // Saved again with no content change (e.g. before submit).
      {
        lessonId,
        content: lookBackEdit,
        authorId: people.approver.id,
        createdAt: new Date('2026-10-25T14:30:00Z'),
      },
    ])

    const versions = await listVersions(db, lessonId)
    expect(versions.map((v) => [v.author?.name ?? null, v.changes])).toEqual([
      [people.approver.name, []],
      [people.reviewer2.name, ['Look Back']],
      [people.reviewer.name, ['Launch']],
      [null, []], // the oldest version has nothing to compare with
    ])
  })
})
