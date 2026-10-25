// R23 transition table (pure). Contract: src/workflow/README.md.
import { describe, expect, it } from 'vitest'
import type { LessonStatus, Role } from '../db/schema'
import {
  STATUS_LABELS,
  WORKFLOW_ACTIONS,
  availableActions,
  isEditableStatus,
  planTransition,
  type WorkflowAction,
} from './transitions'

const STATUSES: LessonStatus[] = [
  'generating',
  'draft',
  'in_review',
  'changes_requested',
  'approved',
  'failed',
]
const ROLES: Role[] = ['author', 'reviewer', 'approver', 'admin']

// The only (status, action) pairs that move a lesson, and where they lead.
const MOVES: Record<WorkflowAction, { from: LessonStatus; to: LessonStatus }> = {
  submit: { from: 'draft', to: 'in_review' },
  resubmit: { from: 'changes_requested', to: 'in_review' },
  request_changes: { from: 'in_review', to: 'changes_requested' },
  approve: { from: 'in_review', to: 'approved' },
  reopen: { from: 'approved', to: 'in_review' },
}

// Roles table: reviewers submit; approvers do everything a reviewer can plus approve or send
// back; admins do everything; authors take no review action.
const ALLOWED_ROLES: Record<WorkflowAction, Role[]> = {
  submit: ['reviewer', 'approver', 'admin'],
  resubmit: ['reviewer', 'approver', 'admin'],
  request_changes: ['approver', 'admin'],
  approve: ['approver', 'admin'],
  reopen: ['approver', 'admin'],
}

describe('WORKFLOW_ACTIONS', () => {
  it('lists the five review actions', () => {
    expect([...WORKFLOW_ACTIONS].sort()).toEqual(
      ['approve', 'reopen', 'request_changes', 'resubmit', 'submit'].sort(),
    )
  })
})

describe('planTransition', () => {
  it.each(Object.entries(MOVES) as [WorkflowAction, { from: LessonStatus; to: LessonStatus }][])(
    '%s moves %o for an allowed role',
    (action, { from, to }) => {
      const role = ALLOWED_ROLES[action][0]!
      expect(planTransition({ status: from, action, role, note: 'A note.' })).toEqual({
        ok: true,
        to,
      })
    },
  )

  it('rejects every other (status, action) pair as an invalid transition', () => {
    expect(WORKFLOW_ACTIONS).toHaveLength(5)
    for (const action of WORKFLOW_ACTIONS) {
      for (const status of STATUSES.filter((s) => s !== MOVES[action].from)) {
        expect(planTransition({ status, action, role: 'admin', note: 'A note.' })).toEqual({
          ok: false,
          reason: 'invalid_transition',
        })
      }
    }
  })

  it('only lets approvers and admins approve, request changes or reopen', () => {
    for (const action of ['approve', 'request_changes', 'reopen'] as const) {
      const { from } = MOVES[action]
      for (const role of ROLES) {
        const result = planTransition({ status: from, action, role, note: 'A note.' })
        expect(result.ok, `${role} ${action}`).toBe(ALLOWED_ROLES[action].includes(role))
        if (!result.ok) {
          expect(result.reason).toBe('forbidden')
        }
      }
    }
  })

  it('lets reviewers, approvers and admins submit and resubmit, but not authors', () => {
    for (const action of ['submit', 'resubmit'] as const) {
      const { from } = MOVES[action]
      for (const role of ROLES) {
        const result = planTransition({ status: from, action, role })
        expect(result.ok, `${role} ${action}`).toBe(ALLOWED_ROLES[action].includes(role))
      }
    }
    expect(planTransition({ status: 'draft', action: 'submit', role: 'author' })).toEqual({
      ok: false,
      reason: 'forbidden',
    })
  })

  it('reports a forbidden role before an invalid status', () => {
    expect(planTransition({ status: 'draft', action: 'approve', role: 'reviewer' })).toEqual({
      ok: false,
      reason: 'forbidden',
    })
  })

  it.each([undefined, null, '', '   \n\t'])('requires a note to request changes (%o)', (note) => {
    expect(
      planTransition({ status: 'in_review', action: 'request_changes', role: 'approver', note }),
    ).toEqual({ ok: false, reason: 'note_required' })
  })

  it('does not require a note for the other actions', () => {
    for (const action of ['submit', 'resubmit', 'approve', 'reopen'] as const) {
      expect(planTransition({ status: MOVES[action].from, action, role: 'admin' }).ok).toBe(true)
    }
  })
})

describe('availableActions', () => {
  it('offers the status bar actions of the design for each status and role', () => {
    expect(availableActions('draft', 'reviewer')).toEqual(['submit'])
    expect(availableActions('in_review', 'reviewer')).toEqual([])
    expect([...availableActions('in_review', 'approver')].sort()).toEqual([
      'approve',
      'request_changes',
    ])
    expect(availableActions('changes_requested', 'reviewer')).toEqual(['resubmit'])
    expect(availableActions('approved', 'approver')).toEqual(['reopen'])
    expect(availableActions('approved', 'reviewer')).toEqual([])
    expect(availableActions('generating', 'admin')).toEqual([])
    expect(availableActions('failed', 'admin')).toEqual([])
  })

  it('offers authors no review action', () => {
    for (const status of STATUSES) {
      expect(availableActions(status, 'author')).toEqual([])
    }
  })

  it('agrees with planTransition for every status and role', () => {
    for (const status of STATUSES) {
      for (const role of ROLES) {
        const expected = WORKFLOW_ACTIONS.filter(
          (action) => planTransition({ status, action, role, note: 'A note.' }).ok,
        )
        expect([...availableActions(status, role)].sort(), `${status} ${role}`).toEqual(
          [...expected].sort(),
        )
      }
    }
  })
})

describe('isEditableStatus', () => {
  it('locks approved lessons and lessons being generated', () => {
    expect(STATUSES.filter((status) => !isEditableStatus(status))).toEqual([
      'generating',
      'approved',
    ])
  })
})

describe('STATUS_LABELS', () => {
  it('has the UI label of every status', () => {
    expect(STATUS_LABELS).toEqual({
      generating: 'Generating',
      draft: 'Draft',
      in_review: 'In review',
      changes_requested: 'Changes requested',
      approved: 'Approved',
      failed: 'Failed',
    })
  })
})
