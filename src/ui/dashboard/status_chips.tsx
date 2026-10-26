import type { LessonStatus } from '../../db/schema'
import { STATUS_LOOKS, StatusPill } from './status_pill'

/** Workflow order of the count chips (R24). */
export const CHIP_ORDER = ['draft', 'in_review', 'changes_requested', 'approved', 'failed'] as const
export type ChipStatus = (typeof CHIP_ORDER)[number]

interface StatusChipsProps {
  counts: Record<LessonStatus, number>
  pressed: readonly LessonStatus[]
  onToggle: (status: ChipStatus) => void
}

/** Lessons per status; each chip is also a toggle that filters the table by that status. */
export function StatusChips({ counts, pressed, onToggle }: StatusChipsProps) {
  return (
    <div className="counts" role="group" aria-label="Lessons per status">
      {CHIP_ORDER.filter((status) => counts[status] > 0).map((status) => (
        <button
          key={status}
          type="button"
          className="cnt"
          aria-pressed={pressed.includes(status)}
          aria-label={`${STATUS_LOOKS[status].label}: ${counts[status]} lessons, filter`}
          onClick={() => onToggle(status)}
        >
          {/* The space keeps the visible text ("Draft 24") inside the accessible name. */}
          <StatusPill status={status} /> {counts[status]}
        </button>
      ))}
    </div>
  )
}
