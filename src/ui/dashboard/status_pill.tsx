import type { ReactNode } from 'react'
import type { LessonStatus } from '../../db/schema'
import {
  CheckIcon,
  CircleIcon,
  ClockIcon,
  ErrorIcon,
  EyeIcon,
  PenMarkIcon,
  PencilIcon,
} from '../icons'

/**
 * What a lesson row shows: its generation state until it has content, then its workflow status
 * (docs/design/STYLE.md, status colours).
 */
export type RowStatus = 'not_generated' | 'queued' | 'generating' | LessonStatus

interface StatusLook {
  label: string
  /** Pill and tile class from the mockups' studio.css. */
  tone: 'none' | 'queued' | 'gen' | 'draft' | 'review' | 'changes' | 'approved' | 'failed'
  icon: () => ReactNode
}

function BreathingDot() {
  return <span className="dot breathe" aria-hidden="true" />
}

export const STATUS_LOOKS: Record<RowStatus, StatusLook> = {
  not_generated: { label: 'Not generated', tone: 'none', icon: CircleIcon },
  queued: { label: 'Queued', tone: 'queued', icon: ClockIcon },
  generating: { label: 'Generating', tone: 'gen', icon: BreathingDot },
  draft: { label: 'Draft', tone: 'draft', icon: PencilIcon },
  in_review: { label: 'In review', tone: 'review', icon: EyeIcon },
  changes_requested: { label: 'Changes requested', tone: 'changes', icon: PenMarkIcon },
  approved: { label: 'Approved', tone: 'approved', icon: CheckIcon },
  failed: { label: 'Failed', tone: 'failed', icon: ErrorIcon },
}

/** Icon and word, never colour alone. */
export function StatusPill({ status }: { status: RowStatus }) {
  const look = STATUS_LOOKS[status]
  const Icon = look.icon
  return (
    <span className={`pill ${look.tone}`}>
      <Icon />
      {look.label}
    </span>
  )
}
