import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { UnitProgress } from '../../generation/progress'
import { GenerationSummary } from './generation_summary'

function stopped(capUsd: number, costUsd: number): UnitProgress {
  const lessons = Array.from({ length: 4 }, (_, index) => ({
    lessonId: `l${index + 1}`,
    lessonNumber: index + 1,
    isFlex: false,
    status: index < 2 ? ('generated' as const) : ('cancelled' as const),
    error: null,
  }))
  return {
    lessons,
    counts: {
      not_started: 0,
      queued: 0,
      generating: 0,
      generated: 2,
      failed: 0,
      cancelled: 2,
    },
    run: {
      id: 'r1',
      status: 'stopped_cap',
      statusLabel: 'stopped: spend cap reached',
      costUsd,
      capUsd,
    },
  }
}

describe('GenerationSummary after an admin raised the cap (D-024 (1))', () => {
  it("doesn't call the new cap the one the run stopped at, and says resume is possible", () => {
    render(<GenerationSummary progress={stopped(8, 5.95)} />)
    const status = screen.getByRole('status', { name: 'Generation stopped' })
    expect(status).toHaveTextContent(
      '2 of 4 lessons were generated before the run reached its spend cap.',
    )
    expect(status).not.toHaveTextContent('$8.00 cap')
    expect(status).toHaveTextContent(
      'An admin raised the cap to $8.00. Resume generates only the lessons that are missing.',
    )
  })
})
