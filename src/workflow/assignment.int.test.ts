// R25 assignment, single and bulk, and the reviewer picker. Contract: src/workflow/README.md.
import { asc, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { connectTestDb } from '../../tests/db'
import {
  cleanWorkflowData,
  createTestUnit,
  createUsers,
  WORKFLOW_EMAIL_PREFIX,
  type FixtureUsers,
} from '../../tests/workflow_fixtures'
import { runMigrations } from '../db/migrate'
import { lessons } from '../db/schema'
import { assignLessons, listAssignableReviewers } from './assignment'
import { InvalidAssigneeError, LessonNotFoundError } from './errors'

const MISSING_ID = '00000000-0000-4000-8000-000000000000'

describe('assignment', () => {
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

  async function threeLessons() {
    return createTestUnit(db, {
      lessons: [{ lessonNumber: 1 }, { lessonNumber: 2 }, { lessonNumber: 3 }],
    })
  }

  async function assignees(lessonIds: string[]) {
    const rows = await db
      .select({ assigneeId: lessons.assigneeId })
      .from(lessons)
      .where(inArray(lessons.id, lessonIds))
      .orderBy(asc(lessons.position))
    return rows.map((row) => row.assigneeId)
  }

  it('assigns one lesson to a reviewer', async () => {
    const unit = await threeLessons()
    await expect(
      assignLessons(db, { lessonIds: [unit.lessonIds[1]!], assigneeId: people.reviewer.id }),
    ).resolves.toEqual({ updated: 1 })
    expect(await assignees(unit.lessonIds)).toEqual([null, people.reviewer.id, null])
  })

  it('assigns in bulk, replacing the current assignee', async () => {
    const unit = await threeLessons()
    await assignLessons(db, { lessonIds: [unit.lessonIds[0]!], assigneeId: people.reviewer2.id })
    await expect(
      assignLessons(db, { lessonIds: unit.lessonIds, assigneeId: people.reviewer.id }),
    ).resolves.toEqual({ updated: 3 })
    expect(await assignees(unit.lessonIds)).toEqual([
      people.reviewer.id,
      people.reviewer.id,
      people.reviewer.id,
    ])
  })

  it('unassigns with a null assignee', async () => {
    const unit = await threeLessons()
    await assignLessons(db, { lessonIds: unit.lessonIds, assigneeId: people.reviewer.id })
    await assignLessons(db, { lessonIds: [unit.lessonIds[2]!], assigneeId: null })
    expect(await assignees(unit.lessonIds)).toEqual([people.reviewer.id, people.reviewer.id, null])
  })

  it('lets approvers be assigned too', async () => {
    const unit = await threeLessons()
    await assignLessons(db, { lessonIds: [unit.lessonIds[0]!], assigneeId: people.approver.id })
    expect((await assignees(unit.lessonIds))[0]).toBe(people.approver.id)
  })

  it.each(['author', 'admin'] as const)(
    'rejects a %s as assignee and changes nothing',
    async (role) => {
      const unit = await threeLessons()
      await expect(
        assignLessons(db, { lessonIds: unit.lessonIds, assigneeId: people[role].id }),
      ).rejects.toBeInstanceOf(InvalidAssigneeError)
      expect(await assignees(unit.lessonIds)).toEqual([null, null, null])
    },
  )

  it('rejects an unknown assignee', async () => {
    const unit = await threeLessons()
    await expect(
      assignLessons(db, { lessonIds: unit.lessonIds, assigneeId: MISSING_ID }),
    ).rejects.toBeInstanceOf(InvalidAssigneeError)
  })

  it('rejects the whole batch when any lesson id is unknown', async () => {
    const unit = await threeLessons()
    await expect(
      assignLessons(db, {
        lessonIds: [unit.lessonIds[0]!, MISSING_ID],
        assigneeId: people.reviewer.id,
      }),
    ).rejects.toBeInstanceOf(LessonNotFoundError)
    await expect(
      assignLessons(db, { lessonIds: ['bad-id'], assigneeId: people.reviewer.id }),
    ).rejects.toBeInstanceOf(LessonNotFoundError)
    expect(await assignees(unit.lessonIds)).toEqual([null, null, null])
  })

  it('treats an empty list as nothing to do', async () => {
    await expect(
      assignLessons(db, { lessonIds: [], assigneeId: people.reviewer.id }),
    ).resolves.toEqual({ updated: 0 })
  })

  describe('listAssignableReviewers', () => {
    it('lists reviewers and approvers by name with their open (not approved) load', async () => {
      await createTestUnit(db, {
        lessons: [
          { lessonNumber: 1, status: 'in_review', assigneeId: people.reviewer.id },
          { lessonNumber: 2, status: 'draft', assigneeId: people.reviewer.id },
          { lessonNumber: 3, status: 'approved', assigneeId: people.reviewer.id },
          { lessonNumber: 4, status: 'draft', assigneeId: people.reviewer2.id },
        ],
      })

      const reviewers = await listAssignableReviewers(db)
      // Only this file's users; the seed may have added others.
      const ours = reviewers.filter((r) => r.email.startsWith(WORKFLOW_EMAIL_PREFIX))
      expect(ours).toEqual([
        {
          id: people.approver.id,
          name: people.approver.name,
          email: `${WORKFLOW_EMAIL_PREFIX}approver@example.com`,
          role: 'approver',
          openAssignments: 0,
        },
        {
          id: people.reviewer.id,
          name: people.reviewer.name,
          email: `${WORKFLOW_EMAIL_PREFIX}reviewer@example.com`,
          role: 'reviewer',
          openAssignments: 2,
        },
        {
          id: people.reviewer2.id,
          name: people.reviewer2.name,
          email: `${WORKFLOW_EMAIL_PREFIX}reviewer2@example.com`,
          role: 'reviewer',
          openAssignments: 1,
        },
      ])
      expect(reviewers.every((r) => r.role === 'reviewer' || r.role === 'approver')).toBe(true)
    })
  })
})
