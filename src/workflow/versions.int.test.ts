// R14 version history: save, list, view and restore. Contract: src/workflow/README.md.
import { asc, eq } from 'drizzle-orm'
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
import { lessonVersions, lessons, type LessonStatus } from '../db/schema'
import { LessonLockedError, LessonNotFoundError, VersionNotFoundError } from './errors'
import { getVersion, listVersions, restoreVersion, saveLessonContent } from './versions'

const MISSING_ID = '00000000-0000-4000-8000-000000000000'

describe('lesson versions', () => {
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

  async function lessonIn(status: LessonStatus, content: unknown = lessonContent('Generated')) {
    const unit = await createTestUnit(db, { lessons: [{ lessonNumber: 1, status, content }] })
    return unit.lessonIds[0]!
  }

  async function lessonRow(lessonId: string) {
    const [row] = await db.select().from(lessons).where(eq(lessons.id, lessonId))
    return row!
  }

  async function versionRows(lessonId: string) {
    return db
      .select()
      .from(lessonVersions)
      .where(eq(lessonVersions.lessonId, lessonId))
      .orderBy(asc(lessonVersions.createdAt))
  }

  describe('saveLessonContent (the 30 s idle save)', () => {
    it('stores the content, the last editor and a version by that editor', async () => {
      const lessonId = await lessonIn('in_review')
      const before = await lessonRow(lessonId)

      const result = await saveLessonContent(db, {
        lessonId,
        userId: people.reviewer.id,
        content: lessonContent('Edited'),
      })

      expect(result).toEqual({ versionId: expect.any(String) })
      const after = await lessonRow(lessonId)
      expect(after.content).toEqual(lessonContent('Edited'))
      expect(after.lastEditedBy).toBe(people.reviewer.id)
      expect(after.updatedAt.getTime()).toBeGreaterThanOrEqual(before.updatedAt.getTime())
      // Saving does not move the workflow (D-024: resubmit is explicit).
      expect(after.status).toBe('in_review')
      const versions = await versionRows(lessonId)
      expect(versions.map((v) => [v.id, v.content, v.authorId])).toEqual([
        [result.versionId, lessonContent('Edited'), people.reviewer.id],
      ])
    })

    it.each(['approved', 'generating'] as const)(
      'rejects saves while the lesson is %s and changes nothing',
      async (status) => {
        const lessonId = await lessonIn(status)
        await expect(
          saveLessonContent(db, {
            lessonId,
            userId: people.reviewer.id,
            content: lessonContent('Sneaky'),
          }),
        ).rejects.toBeInstanceOf(LessonLockedError)
        expect((await lessonRow(lessonId)).content).toEqual(lessonContent('Generated'))
        expect(await versionRows(lessonId)).toEqual([])
      },
    )

    it('rejects an unknown lesson', async () => {
      await expect(
        saveLessonContent(db, { lessonId: MISSING_ID, userId: people.reviewer.id, content: {} }),
      ).rejects.toBeInstanceOf(LessonNotFoundError)
    })
  })

  describe('listVersions and getVersion', () => {
    it('lists versions newest first with who and when, without content', async () => {
      const lessonId = await lessonIn('draft')
      // A generated version has no author (M2 writes it with author_id null).
      await db.insert(lessonVersions).values({ lessonId, content: lessonContent('Generated') })
      await saveLessonContent(db, {
        lessonId,
        userId: people.reviewer.id,
        content: lessonContent('First edit'),
      })
      await saveLessonContent(db, {
        lessonId,
        userId: people.approver.id,
        content: lessonContent('Second edit'),
      })

      const versions = await listVersions(db, lessonId)
      expect(versions).toEqual([
        {
          id: expect.any(String),
          createdAt: expect.any(Date),
          author: { id: people.approver.id, name: people.approver.name },
        },
        {
          id: expect.any(String),
          createdAt: expect.any(Date),
          author: { id: people.reviewer.id, name: people.reviewer.name },
        },
        { id: expect.any(String), createdAt: expect.any(Date), author: null },
      ])
      const times = versions.map((v) => v.createdAt.getTime())
      expect(times).toEqual([...times].sort((a, b) => b - a))
    })

    it('returns one version with its content', async () => {
      const lessonId = await lessonIn('draft')
      const { versionId } = await saveLessonContent(db, {
        lessonId,
        userId: people.reviewer.id,
        content: lessonContent('Viewed'),
      })
      await expect(getVersion(db, { lessonId, versionId })).resolves.toEqual({
        id: versionId,
        lessonId,
        content: lessonContent('Viewed'),
        createdAt: expect.any(Date),
        author: { id: people.reviewer.id, name: people.reviewer.name },
      })
    })

    it('does not return a version through another lesson or an unknown id', async () => {
      const unit = await createTestUnit(db, {
        lessons: [
          { lessonNumber: 1, content: lessonContent('One') },
          { lessonNumber: 2, content: lessonContent('Two') },
        ],
      })
      const [one, two] = unit.lessonIds as [string, string]
      const { versionId } = await saveLessonContent(db, {
        lessonId: one,
        userId: people.reviewer.id,
        content: lessonContent('One edited'),
      })
      await expect(getVersion(db, { lessonId: two, versionId })).resolves.toBeNull()
      await expect(getVersion(db, { lessonId: one, versionId: MISSING_ID })).resolves.toBeNull()
      await expect(getVersion(db, { lessonId: one, versionId: 'nope' })).resolves.toBeNull()
    })

    it('rejects listing an unknown lesson', async () => {
      await expect(listVersions(db, MISSING_ID)).rejects.toBeInstanceOf(LessonNotFoundError)
    })
  })

  describe('restoreVersion', () => {
    it('restores an earlier version as a new version by the restorer', async () => {
      const lessonId = await lessonIn('in_review')
      const first = await saveLessonContent(db, {
        lessonId,
        userId: people.reviewer.id,
        content: lessonContent('Good'),
      })
      await saveLessonContent(db, {
        lessonId,
        userId: people.reviewer2.id,
        content: lessonContent('Worse'),
      })

      const restored = await restoreVersion(db, {
        lessonId,
        versionId: first.versionId,
        userId: people.approver.id,
      })

      expect(restored).toEqual({ versionId: expect.any(String) })
      expect(restored.versionId).not.toBe(first.versionId)
      const lesson = await lessonRow(lessonId)
      expect(lesson.content).toEqual(lessonContent('Good'))
      expect(lesson.lastEditedBy).toBe(people.approver.id)
      expect(lesson.status).toBe('in_review')
      // Earlier versions stay; the restore is appended.
      const versions = await versionRows(lessonId)
      expect(versions.map((v) => [v.content, v.authorId])).toEqual([
        [lessonContent('Good'), people.reviewer.id],
        [lessonContent('Worse'), people.reviewer2.id],
        [lessonContent('Good'), people.approver.id],
      ])
      expect(versions.at(-1)!.id).toBe(restored.versionId)
    })

    it('first saves current content that has no version yet (D-024)', async () => {
      const lessonId = await lessonIn('draft')
      const first = await saveLessonContent(db, {
        lessonId,
        userId: people.reviewer.id,
        content: lessonContent('Saved'),
      })
      // Typed in the editor since the last save, not yet saved as a version.
      await db
        .update(lessons)
        .set({ content: lessonContent('Unsaved'), lastEditedBy: people.reviewer2.id })
        .where(eq(lessons.id, lessonId))

      await restoreVersion(db, { lessonId, versionId: first.versionId, userId: people.admin.id })

      const versions = await versionRows(lessonId)
      expect(versions.map((v) => [v.content, v.authorId])).toEqual([
        [lessonContent('Saved'), people.reviewer.id],
        [lessonContent('Unsaved'), people.admin.id],
        [lessonContent('Saved'), people.admin.id],
      ])
    })

    it.each(['approved', 'generating'] as const)(
      'rejects a restore while the lesson is %s',
      async (status) => {
        const lessonId = await lessonIn('draft')
        const { versionId } = await saveLessonContent(db, {
          lessonId,
          userId: people.reviewer.id,
          content: lessonContent('Saved'),
        })
        await db.update(lessons).set({ status }).where(eq(lessons.id, lessonId))
        await expect(
          restoreVersion(db, { lessonId, versionId, userId: people.reviewer.id }),
        ).rejects.toBeInstanceOf(LessonLockedError)
        expect(await versionRows(lessonId)).toHaveLength(1)
      },
    )

    it("rejects another lesson's version or an unknown one", async () => {
      const unit = await createTestUnit(db, {
        lessons: [
          { lessonNumber: 1, content: lessonContent('One') },
          { lessonNumber: 2, content: lessonContent('Two') },
        ],
      })
      const [one, two] = unit.lessonIds as [string, string]
      const { versionId } = await saveLessonContent(db, {
        lessonId: one,
        userId: people.reviewer.id,
        content: lessonContent('One edited'),
      })
      await expect(
        restoreVersion(db, { lessonId: two, versionId, userId: people.reviewer.id }),
      ).rejects.toBeInstanceOf(VersionNotFoundError)
      await expect(
        restoreVersion(db, { lessonId: one, versionId: MISSING_ID, userId: people.reviewer.id }),
      ).rejects.toBeInstanceOf(VersionNotFoundError)
      expect((await lessonRow(two)).content).toEqual(lessonContent('Two'))
    })
  })
})
