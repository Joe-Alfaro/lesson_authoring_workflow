import type { LessonStatus } from '../../db/schema'
import { STATUS_LABELS } from '../../workflow/transitions'
import { Icon, type IconName } from './lesson_icons'

const PILLS: Record<LessonStatus, { className: string; icon: IconName | null }> = {
  generating: { className: 'gen', icon: null },
  draft: { className: 'draft', icon: 'pencil' },
  in_review: { className: 'review', icon: 'eye' },
  changes_requested: { className: 'changes', icon: 'pen' },
  approved: { className: 'approved', icon: 'check' },
  failed: { className: 'failed', icon: 'warning' },
}

/** Workflow status: icon plus word, never colour alone (STYLE.md). */
export function StatusPill({ status }: { status: LessonStatus }) {
  const pill = PILLS[status]
  return (
    <span className={`pill ${pill.className} lg`}>
      {pill.icon ? <Icon name={pill.icon} /> : <span className="dot breathe" aria-hidden="true" />}
      {STATUS_LABELS[status]}
    </span>
  )
}
