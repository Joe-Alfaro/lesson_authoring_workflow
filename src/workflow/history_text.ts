// R23 history timeline wording ("Reviewer 03 submitted for review"). Contract: src/assist/README.md.
import type { LessonStatus } from '../db/schema'
import { STATUS_LABELS } from './transitions'

export function historyEventText({
  fromStatus,
  toStatus,
}: {
  fromStatus: LessonStatus | null
  toStatus: LessonStatus
}): string {
  if (toStatus === 'generating') return 'started generating'
  if (fromStatus === 'draft' && toStatus === 'in_review') return 'submitted for review'
  if (fromStatus === 'changes_requested' && toStatus === 'in_review')
    return 'resubmitted for review'
  if (fromStatus === 'in_review' && toStatus === 'changes_requested') return 'requested changes'
  if (fromStatus === 'in_review' && toStatus === 'approved') return 'approved'
  if (fromStatus === 'approved' && toStatus === 'in_review') return 'reopened for edits'
  if (fromStatus === 'generating' && toStatus === 'draft') return 'generated as Draft'
  if (fromStatus === 'generating' && toStatus === 'failed') return 'generation failed'
  return `moved to ${STATUS_LABELS[toStatus]}`
}
