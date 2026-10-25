// R23 against the database: transitions, workflow_events history, the approved lock and the
// system (generation) transitions. Contract: src/workflow/README.md.
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
import { lessonVersions, lessons, workflowEvents, type LessonStatus } from '../db/schema'
import {
  InvalidTransitionError,
  LessonLockedError,
  LessonNotFoundError,
  NoteRequiredError,
  WorkflowForbiddenError,
} from './errors'
import {
  applySystemTransition,
  assertLessonEditable,
  getLessonHistory,
  transitionLesson,
} from './service'

const MISSING_ID = '00000000-0000-4000-8000-000000000000'

describe('workflow service', () => {
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

  async function lessonIn(status: LessonStatus, content: unknown = lessonContent('Lesson 1')) {
    const unit = await createTestUnit(db, { lessons: [{ lessonNumber: 1, status, content }] })
    return unit.lessonIds[0]!
  }

  async function statusOf(lessonId: string) {
    const [row] = await db
      .select({ status: lessons.status })
      .from(lessons)
      .where(eq(lessons.id, lessonId))
    return row?.status
  }

  async function eventsOf(lessonId: string) {
    return db
      .select()
      .from(workflowEvents)
      .where(eq(workflowEvents.lessonId, lessonId))
      .orderBy(asc(workflowEvents.at))
  }

  async function versionsOf(lessonId: string) {
    return db
      .select()
      .from(lessonVersions)
      .where(eq(lessonVersions.lessonId, lessonId))
      .orderBy(asc(lessonVersions.createdAt))
  }

  it('walks Draft -> In review -> Changes requested -> In review -> Approved', async () => {
    const lessonId = await lessonIn('draft')
    const reviewer = { id: people.reviewer.id, role: people.reviewer.role }
    const approver = { id: people.approver.id, role: people.approver.role }

    await expect(
      transitionLesson(db, { lessonId, action: 'submit', actor: reviewer }),
    ).resolves.toMatchObject({ status: 'in_review' })
    await transitionLesson(db, {
      lessonId,
      action: 'request_changes',
      actor: approver,
      note: 'Tighten the Look Back questions.',
    })
    expect(await statusOf(lessonId)).toBe('changes_requested')
    await transitionLesson(db, { lessonId, action: 'resubmit', actor: reviewer })
    expect(await statusOf(lessonId)).toBe('in_review')
    await transitionLesson(db, { lessonId, action: 'approve', actor: approver })
    expect(await statusOf(lessonId)).toBe('approved')

    const events = await eventsOf(lessonId)
    expect(events.map((e) => [e.fromStatus, e.toStatus, e.actorId, e.note])).toEqual([
      ['draft', 'in_review', people.reviewer.id, null],
      ['in_review', 'changes_requested', people.approver.id, 'Tighten the Look Back questions.'],
      ['changes_requested', 'in_review', people.reviewer.id, null],
      ['in_review', 'approved', people.approver.id, null],
    ])
    for (const event of events) {
      expect(event.at).toBeInstanceOf(Date)
    }
  })

  it('returns the new status and the recorded event', async () => {
    const lessonId = await lessonIn('in_review')
    const result = await transitionLesson(db, {
      lessonId,
      action: 'request_changes',
      actor: { id: people.admin.id, role: 'admin' },
      note: '  Needs a pulse check.  ',
    })
    expect(result).toEqual({
      status: 'changes_requested',
      event: {
        id: expect.any(String),
        fromStatus: 'in_review',
        toStatus: 'changes_requested',
        actor: { id: people.admin.id, name: people.admin.name, role: 'admin' },
        note: 'Needs a pulse check.',
        at: expect.any(Date),
      },
    })
  })

  it.each(['reviewer', 'author'] as const)(
    'rejects approve and request changes by a %s and records nothing',
    async (role) => {
      const lessonId = await lessonIn('in_review')
      const actor = { id: people[role].id, role }
      await expect(
        transitionLesson(db, { lessonId, action: 'approve', actor }),
      ).rejects.toBeInstanceOf(WorkflowForbiddenError)
      await expect(
        transitionLesson(db, { lessonId, action: 'request_changes', actor, note: 'x' }),
      ).rejects.toBeInstanceOf(WorkflowForbiddenError)
      expect(await statusOf(lessonId)).toBe('in_review')
      expect(await eventsOf(lessonId)).toEqual([])
    },
  )

  it('requires a note to request changes', async () => {
    const lessonId = await lessonIn('in_review')
    await expect(
      transitionLesson(db, {
        lessonId,
        action: 'request_changes',
        actor: { id: people.approver.id, role: 'approver' },
        note: '   ',
      }),
    ).rejects.toBeInstanceOf(NoteRequiredError)
    expect(await statusOf(lessonId)).toBe('in_review')
    expect(await eventsOf(lessonId)).toEqual([])
  })

  it('rejects a transition that the current status does not allow', async () => {
    const lessonId = await lessonIn('draft')
    await expect(
      transitionLesson(db, {
        lessonId,
        action: 'approve',
        actor: { id: people.approver.id, role: 'approver' },
      }),
    ).rejects.toBeInstanceOf(InvalidTransitionError)
    // Changes requested goes back to In review only by an explicit resubmit (D-024).
    const sentBack = await lessonIn('changes_requested')
    await expect(
      transitionLesson(db, {
        lessonId: sentBack,
        action: 'submit',
        actor: { id: people.reviewer.id, role: 'reviewer' },
      }),
    ).rejects.toBeInstanceOf(InvalidTransitionError)
  })

  it('does not submit a Draft that has not been generated (null content)', async () => {
    const lessonId = await lessonIn('draft', null)
    await expect(
      transitionLesson(db, {
        lessonId,
        action: 'submit',
        actor: { id: people.reviewer.id, role: 'reviewer' },
      }),
    ).rejects.toBeInstanceOf(InvalidTransitionError)
  })

  it('rejects an unknown or malformed lesson id', async () => {
    const actor = { id: people.admin.id, role: 'admin' as const }
    await expect(
      transitionLesson(db, { lessonId: MISSING_ID, action: 'approve', actor }),
    ).rejects.toBeInstanceOf(LessonNotFoundError)
    await expect(
      transitionLesson(db, { lessonId: 'not-a-uuid', action: 'approve', actor }),
    ).rejects.toBeInstanceOf(LessonNotFoundError)
  })

  it('lets an approver reopen an approved lesson, which returns it to In review', async () => {
    const lessonId = await lessonIn('approved')
    await expect(
      transitionLesson(db, {
        lessonId,
        action: 'reopen',
        actor: { id: people.reviewer.id, role: 'reviewer' },
      }),
    ).rejects.toBeInstanceOf(WorkflowForbiddenError)
    await transitionLesson(db, {
      lessonId,
      action: 'reopen',
      actor: { id: people.approver.id, role: 'approver' },
      note: 'Fixing a typo.',
    })
    expect(await statusOf(lessonId)).toBe('in_review')
    await expect(assertLessonEditable(db, lessonId)).resolves.toBeUndefined()
  })

  it('applies exactly one of two concurrent approvals', async () => {
    const lessonId = await lessonIn('in_review')
    const results = await Promise.allSettled([
      transitionLesson(db, {
        lessonId,
        action: 'approve',
        actor: { id: people.approver.id, role: 'approver' },
      }),
      transitionLesson(db, {
        lessonId,
        action: 'request_changes',
        actor: { id: people.admin.id, role: 'admin' },
        note: 'Racing.',
      }),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toBeInstanceOf(InvalidTransitionError)
    expect(await eventsOf(lessonId)).toHaveLength(1)
  })

  describe('versions before submit and approve (D-024)', () => {
    it('saves unsaved content as a version by the actor before submit and approve', async () => {
      const lessonId = await lessonIn('draft', lessonContent('Original'))
      // Content changed by the editor (Yjs) without a version yet.
      await db
        .update(lessons)
        .set({ content: lessonContent('Edited') })
        .where(eq(lessons.id, lessonId))

      await transitionLesson(db, {
        lessonId,
        action: 'submit',
        actor: { id: people.reviewer.id, role: 'reviewer' },
      })
      let versions = await versionsOf(lessonId)
      expect(versions.map((v) => [v.content, v.authorId])).toEqual([
        [lessonContent('Edited'), people.reviewer.id],
      ])

      await db
        .update(lessons)
        .set({ content: lessonContent('Edited again') })
        .where(eq(lessons.id, lessonId))
      await transitionLesson(db, {
        lessonId,
        action: 'approve',
        actor: { id: people.approver.id, role: 'approver' },
      })
      versions = await versionsOf(lessonId)
      expect(versions.map((v) => [v.content, v.authorId])).toEqual([
        [lessonContent('Edited'), people.reviewer.id],
        [lessonContent('Edited again'), people.approver.id],
      ])
    })

    it('adds no version when the content equals the latest version', async () => {
      const lessonId = await lessonIn('draft', lessonContent('Same'))
      await db.insert(lessonVersions).values({ lessonId, content: lessonContent('Same') })
      await transitionLesson(db, {
        lessonId,
        action: 'submit',
        actor: { id: people.reviewer.id, role: 'reviewer' },
      })
      expect(await versionsOf(lessonId)).toHaveLength(1)
    })
  })

  describe('getLessonHistory', () => {
    it('lists every transition oldest first with who, when and the note', async () => {
      const lessonId = await lessonIn('draft')
      await transitionLesson(db, {
        lessonId,
        action: 'submit',
        actor: { id: people.reviewer.id, role: 'reviewer' },
      })
      await transitionLesson(db, {
        lessonId,
        action: 'request_changes',
        actor: { id: people.approver.id, role: 'approver' },
        note: 'Add an exemplar response.',
      })

      const history = await getLessonHistory(db, lessonId)
      expect(history).toEqual([
        {
          id: expect.any(String),
          fromStatus: 'draft',
          toStatus: 'in_review',
          actor: { id: people.reviewer.id, name: people.reviewer.name, role: 'reviewer' },
          note: null,
          at: expect.any(Date),
        },
        {
          id: expect.any(String),
          fromStatus: 'in_review',
          toStatus: 'changes_requested',
          actor: { id: people.approver.id, name: people.approver.name, role: 'approver' },
          note: 'Add an exemplar response.',
          at: expect.any(Date),
        },
      ])
      expect(history[0]!.at.getTime()).toBeLessThanOrEqual(history[1]!.at.getTime())
    })

    it('shows system transitions with a null actor', async () => {
      const lessonId = await lessonIn('draft', null)
      await applySystemTransition(db, { lessonId, to: 'generating' })
      await applySystemTransition(db, { lessonId, to: 'failed', note: 'Model output invalid.' })
      const history = await getLessonHistory(db, lessonId)
      expect(history.map((e) => [e.fromStatus, e.toStatus, e.actor, e.note])).toEqual([
        ['draft', 'generating', null, null],
        ['generating', 'failed', null, 'Model output invalid.'],
      ])
    })

    it('rejects an unknown lesson', async () => {
      await expect(getLessonHistory(db, MISSING_ID)).rejects.toBeInstanceOf(LessonNotFoundError)
    })
  })

  describe('applySystemTransition (generation: Generating -> Draft, plus Failed)', () => {
    it('moves a lesson into Generating and out to Draft or Failed', async () => {
      const ok = await lessonIn('draft', null)
      await applySystemTransition(db, { lessonId: ok, to: 'generating' })
      expect(await statusOf(ok)).toBe('generating')
      await applySystemTransition(db, { lessonId: ok, to: 'draft' })
      expect(await statusOf(ok)).toBe('draft')

      const failed = await lessonIn('generating', null)
      await applySystemTransition(db, { lessonId: failed, to: 'failed' })
      expect(await statusOf(failed)).toBe('failed')
      // A failed lesson can be retried.
      await applySystemTransition(db, { lessonId: failed, to: 'generating' })
      expect(await statusOf(failed)).toBe('generating')
    })

    it('rejects moves that generation does not make', async () => {
      const generating = await lessonIn('generating', null)
      await expect(
        applySystemTransition(db, { lessonId: generating, to: 'generating' }),
      ).rejects.toBeInstanceOf(InvalidTransitionError)
      const draft = await lessonIn('draft')
      await expect(
        applySystemTransition(db, { lessonId: draft, to: 'failed' }),
      ).rejects.toBeInstanceOf(InvalidTransitionError)
      await expect(
        applySystemTransition(db, { lessonId: draft, to: 'approved' as never }),
      ).rejects.toBeInstanceOf(InvalidTransitionError)
      expect(await eventsOf(draft)).toEqual([])
    })
  })

  describe('assertLessonEditable (approved lock)', () => {
    it('rejects edits to approved lessons and lessons being generated', async () => {
      await expect(assertLessonEditable(db, await lessonIn('approved'))).rejects.toBeInstanceOf(
        LessonLockedError,
      )
      await expect(
        assertLessonEditable(db, await lessonIn('generating', null)),
      ).rejects.toBeInstanceOf(LessonLockedError)
    })

    it.each(['draft', 'in_review', 'changes_requested', 'failed'] as const)(
      'allows edits in %s',
      async (status) => {
        await expect(assertLessonEditable(db, await lessonIn(status))).resolves.toBeUndefined()
      },
    )

    it('rejects an unknown lesson', async () => {
      await expect(assertLessonEditable(db, MISSING_ID)).rejects.toBeInstanceOf(LessonNotFoundError)
    })
  })
})
