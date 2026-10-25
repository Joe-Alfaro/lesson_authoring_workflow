import type { LessonStatus, Role } from '../db/schema'

// R23 review actions. Generating, Draft and Failed changes made by generation are system
// transitions (service.ts), not actions.
export const WORKFLOW_ACTIONS = [
  'submit',
  'resubmit',
  'request_changes',
  'approve',
  'reopen',
] as const

export type WorkflowAction = (typeof WORKFLOW_ACTIONS)[number]

interface ActionRule {
  from: LessonStatus
  to: LessonStatus
  /** Admins always pass; authors take no review action. */
  roles: readonly Role[]
  noteRequired: boolean
}

const RULES: Record<WorkflowAction, ActionRule> = {
  submit: { from: 'draft', to: 'in_review', roles: ['reviewer', 'approver'], noteRequired: false },
  // Changes requested returns to In review only by this explicit action (D-024).
  resubmit: {
    from: 'changes_requested',
    to: 'in_review',
    roles: ['reviewer', 'approver'],
    noteRequired: false,
  },
  request_changes: {
    from: 'in_review',
    to: 'changes_requested',
    roles: ['approver'],
    noteRequired: true,
  },
  approve: { from: 'in_review', to: 'approved', roles: ['approver'], noteRequired: false },
  reopen: { from: 'approved', to: 'in_review', roles: ['approver'], noteRequired: false },
}

export const STATUS_LABELS: Record<LessonStatus, string> = {
  generating: 'Generating',
  draft: 'Draft',
  in_review: 'In review',
  changes_requested: 'Changes requested',
  approved: 'Approved',
  failed: 'Failed',
}

export type TransitionPlan =
  | { ok: true; to: LessonStatus }
  | { ok: false; reason: 'forbidden' | 'invalid_transition' | 'note_required' }

export function isWorkflowAction(value: unknown): value is WorkflowAction {
  return typeof value === 'string' && (WORKFLOW_ACTIONS as readonly string[]).includes(value)
}

export function isBlankNote(note: string | null | undefined): boolean {
  return note == null || note.trim() === ''
}

/** Checks role, then status, then note (README order). */
export function planTransition(input: {
  status: LessonStatus
  action: WorkflowAction
  role: Role
  note?: string | null
}): TransitionPlan {
  const rule = RULES[input.action]
  if (input.role !== 'admin' && !rule.roles.includes(input.role)) {
    return { ok: false, reason: 'forbidden' }
  }
  if (input.status !== rule.from) {
    return { ok: false, reason: 'invalid_transition' }
  }
  if (rule.noteRequired && isBlankNote(input.note)) {
    return { ok: false, reason: 'note_required' }
  }
  return { ok: true, to: rule.to }
}

/** The actions a role can take on a lesson in this status (the note is asked for separately). */
export function availableActions(status: LessonStatus, role: Role): WorkflowAction[] {
  return WORKFLOW_ACTIONS.filter((action) => {
    const plan = planTransition({ status, action, role, note: 'note' })
    return plan.ok
  })
}

/** Approved lessons are locked until reopened; generating ones until generation finishes. */
export function isEditableStatus(status: LessonStatus): boolean {
  return status !== 'approved' && status !== 'generating'
}
