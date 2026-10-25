// R24 unit review dashboard and R25 "My lessons". Contract: src/workflow/README.md.
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
import { lessons, type LessonStatus } from '../db/schema'
import { getMyLessons, getUnitDashboard } from './dashboard'

const MISSING_ID = '00000000-0000-4000-8000-000000000000'

const ZERO_COUNTS: Record<LessonStatus, number> = {
  generating: 0,
  draft: 0,
  in_review: 0,
  changes_requested: 0,
  approved: 0,
  failed: 0,
}

describe('unit dashboard', () => {
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

  // Lesson 1 approved, 2 in review (reviewer), 3 draft not generated, flex day draft,
  // 4 changes requested (reviewer2) in arc 2, 5 failed in arc 2.
  async function mixedUnit() {
    return createTestUnit(db, {
      arcs: ['Investigation 1', 'Investigation 2'],
      lessons: [
        {
          lessonNumber: 1,
          status: 'approved',
          content: lessonContent('Meeting the narrator'),
          assigneeId: people.reviewer.id,
          lastEditedBy: people.approver.id,
        },
        {
          lessonNumber: 2,
          status: 'in_review',
          content: lessonContent('Second'),
          assigneeId: people.reviewer.id,
          lastEditedBy: people.reviewer.id,
        },
        { lessonNumber: 3, status: 'draft' },
        { lessonNumber: null, status: 'draft' },
        {
          lessonNumber: 4,
          arc: 1,
          status: 'changes_requested',
          content: lessonContent('Fourth'),
          assigneeId: people.reviewer2.id,
        },
        { lessonNumber: 5, arc: 1, status: 'failed' },
      ],
    })
  }

  describe('getUnitDashboard', () => {
    it('lists every lesson in outline order with status, assignee, last editor and updated', async () => {
      const unit = await mixedUnit()
      const dashboard = await getUnitDashboard(db, unit.unitId)

      expect(dashboard).not.toBeNull()
      expect(dashboard!.unit).toEqual({
        id: unit.unitId,
        grade: 6,
        unitNumber: 4,
        anchorTextTitle: 'Placeholder Anchor Novel',
      })
      expect(dashboard!.arcs).toEqual([
        { id: unit.arcIds[0], name: 'Investigation 1', position: 0 },
        { id: unit.arcIds[1], name: 'Investigation 2', position: 1 },
      ])
      expect(dashboard!.lessons.map((l) => [l.lessonNumber, l.isFlex, l.status])).toEqual([
        [1, false, 'approved'],
        [2, false, 'in_review'],
        [3, false, 'draft'],
        [null, true, 'draft'],
        [4, false, 'changes_requested'],
        [5, false, 'failed'],
      ])
      expect(dashboard!.lessons[0]).toEqual({
        id: unit.lessonIds[0],
        lessonNumber: 1,
        isFlex: false,
        position: 0,
        // D-024 (7): the generated title once content exists.
        title: 'Meeting the narrator',
        outlineLine: 'Lesson 1 outline line.',
        lessonType: 'Core Reading',
        arc: { id: unit.arcIds[0], name: 'Investigation 1' },
        status: 'approved',
        assignee: { id: people.reviewer.id, name: people.reviewer.name },
        lastEditor: { id: people.approver.id, name: people.approver.name },
        updatedAt: expect.any(Date),
      })
      // Not generated: the title falls back to the outline description's first line.
      expect(dashboard!.lessons[2]).toMatchObject({
        title: 'Lesson 3 outline line.',
        assignee: null,
        lastEditor: null,
      })
    })

    it('counts numbered lessons per status (flex days excluded) and the unit is not complete', async () => {
      const unit = await mixedUnit()
      const dashboard = await getUnitDashboard(db, unit.unitId)
      expect(dashboard!.counts).toEqual({
        ...ZERO_COUNTS,
        approved: 1,
        in_review: 1,
        draft: 1,
        changes_requested: 1,
        failed: 1,
      })
      expect(dashboard!.total).toBe(5)
      expect(dashboard!.complete).toBe(false)
    })

    it('marks the unit complete when every numbered lesson is Approved', async () => {
      const unit = await createTestUnit(db, {
        lessons: [
          { lessonNumber: 1, status: 'approved', content: lessonContent('One') },
          { lessonNumber: 2, status: 'approved', content: lessonContent('Two') },
          // A flex day that was never generated does not hold the unit back.
          { lessonNumber: null, status: 'draft' },
        ],
      })
      const dashboard = await getUnitDashboard(db, unit.unitId)
      expect(dashboard!.counts).toEqual({ ...ZERO_COUNTS, approved: 2 })
      expect(dashboard!.complete).toBe(true)

      await db
        .update(lessons)
        .set({ status: 'in_review' })
        .where(eq(lessons.id, unit.lessonIds[1]!))
      expect((await getUnitDashboard(db, unit.unitId))!.complete).toBe(false)
    })

    it('filters by one or more statuses, by arc and by assignee, but counts stay unit-wide', async () => {
      const unit = await mixedUnit()
      const numbers = async (filters: Parameters<typeof getUnitDashboard>[2]) => {
        const dashboard = await getUnitDashboard(db, unit.unitId, filters)
        expect(dashboard!.counts.approved).toBe(1)
        return dashboard!.lessons.map((l) => l.lessonNumber)
      }

      expect(await numbers({ status: ['in_review'] })).toEqual([2])
      expect(await numbers({ status: ['draft', 'failed'] })).toEqual([3, null, 5])
      expect(await numbers({ arcId: unit.arcIds[1] })).toEqual([4, 5])
      expect(await numbers({ assigneeId: people.reviewer.id })).toEqual([1, 2])
      expect(await numbers({ assigneeId: null })).toEqual([3, null, 5])
      expect(
        await numbers({
          status: ['in_review', 'changes_requested'],
          assigneeId: people.reviewer2.id,
        }),
      ).toEqual([4])
      expect(await numbers({ arcId: MISSING_ID })).toEqual([])
    })

    it('answers null for an unknown or malformed unit id', async () => {
      await expect(getUnitDashboard(db, MISSING_ID)).resolves.toBeNull()
      await expect(getUnitDashboard(db, 'unit-1')).resolves.toBeNull()
    })
  })

  describe('getMyLessons', () => {
    it("groups a reviewer's assigned lessons by unit with status counts", async () => {
      const first = await mixedUnit()
      const second = await createTestUnit(db, {
        lessons: [
          {
            lessonNumber: 7,
            status: 'draft',
            content: lessonContent('Seven'),
            assigneeId: people.reviewer.id,
          },
          { lessonNumber: 8, status: 'draft', assigneeId: people.reviewer2.id },
        ],
      })

      const mine = await getMyLessons(db, people.reviewer.id)

      expect(mine.units).toHaveLength(2)
      const byUnit = Object.fromEntries(mine.units.map((group) => [group.unit.id, group]))
      expect(byUnit[first.unitId]!.lessons.map((l) => l.lessonNumber)).toEqual([1, 2])
      expect(byUnit[first.unitId]!.counts).toEqual({ ...ZERO_COUNTS, approved: 1, in_review: 1 })
      expect(byUnit[second.unitId]!.lessons).toEqual([
        expect.objectContaining({
          id: second.lessonIds[0],
          lessonNumber: 7,
          title: 'Seven',
          status: 'draft',
          assignee: { id: people.reviewer.id, name: people.reviewer.name },
        }),
      ])
      expect(byUnit[second.unitId]!.unit).toEqual({
        id: second.unitId,
        grade: 6,
        unitNumber: 4,
        anchorTextTitle: 'Placeholder Anchor Novel',
      })
    })

    it('is empty for a user with no assignments', async () => {
      await mixedUnit()
      await expect(getMyLessons(db, people.author.id)).resolves.toEqual({ units: [] })
    })
  })
})
