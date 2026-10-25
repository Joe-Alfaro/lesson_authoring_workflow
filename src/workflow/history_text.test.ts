// R23 history timeline wording (mockup R23-history: "Reviewer 03 submitted for review", "Approver 01
// requested changes", "System generated as Draft ..."). Contract: src/assist/README.md (M4).
import { describe, expect, it } from 'vitest'
import type { LessonStatus } from '../db/schema'
import { historyEventText } from './history_text'

describe('historyEventText (R23)', () => {
  it.each<[LessonStatus | null, LessonStatus, string]>([
    ['draft', 'in_review', 'submitted for review'],
    ['changes_requested', 'in_review', 'resubmitted for review'],
    ['in_review', 'changes_requested', 'requested changes'],
    ['in_review', 'approved', 'approved'],
    ['approved', 'in_review', 'reopened for edits'],
    [null, 'generating', 'started generating'],
    ['draft', 'generating', 'started generating'],
    ['generating', 'draft', 'generated as Draft'],
    ['generating', 'failed', 'generation failed'],
    [null, 'draft', 'moved to Draft'],
  ])('%s -> %s reads "%s"', (fromStatus, toStatus, text) => {
    expect(historyEventText({ fromStatus, toStatus })).toBe(text)
  })
})
