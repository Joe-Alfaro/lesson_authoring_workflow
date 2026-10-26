import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { LessonGenerationStatus, UnitProgress } from '../../generation/progress'
import { LESSON_GENERATION_STATUSES } from '../../generation/progress'
import { expectNoAxeViolations } from '../../../tests/component_axe'
import { GenerationSummary } from './generation_summary'

/** 41 numbered lessons with the given statuses (default not_started) plus 6 flex days. */
function progressOf(
  statuses: Partial<Record<number, LessonGenerationStatus>>,
  run: UnitProgress['run'],
): UnitProgress {
  const numbered = Array.from({ length: 41 }, (_, index) => ({
    lessonId: `lesson-${index + 1}`,
    lessonNumber: index + 1,
    isFlex: false,
    status: statuses[index + 1] ?? ('not_started' as const),
    error: null,
  }))
  const flex = Array.from({ length: 6 }, (_, index) => ({
    lessonId: `flex-${index + 1}`,
    lessonNumber: null,
    isFlex: true,
    status: 'not_started' as const,
    error: null,
  }))
  const lessons = [...numbered, ...flex]
  const counts = Object.fromEntries(LESSON_GENERATION_STATUSES.map((s) => [s, 0])) as Record<
    LessonGenerationStatus,
    number
  >
  lessons.forEach((lesson) => {
    counts[lesson.status] += 1
  })
  return { lessons, counts, run }
}

function statusesFor(groups: [LessonGenerationStatus, number[]][]) {
  return Object.fromEntries(groups.flatMap(([status, numbers]) => numbers.map((n) => [n, status])))
}

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => from + index)

describe('GenerationSummary', () => {
  it('before any run: 0 of 41 generated and an invitation to review the prompt', () => {
    render(<GenerationSummary progress={progressOf({}, null)} />)
    const region = screen.getByRole('region', { name: 'Generation' })
    expect(region).toHaveTextContent('0 of 41 generated')
    expect(region).toHaveTextContent(
      'Nothing has been generated yet. Review the prompt, then start generation.',
    )
  })

  it('while running: generated count, a Running pill and the per-status line, announced politely', async () => {
    const statuses = statusesFor([
      ['generated', [...range(1, 8), ...range(10, 13), ...range(15, 17)]],
      ['failed', [9, 14]],
      ['generating', range(18, 21)],
      ['queued', range(22, 41)],
    ])
    const { container } = render(
      <GenerationSummary
        progress={progressOf(statuses, {
          id: 'run-1',
          status: 'running',
          statusLabel: 'running',
          costUsd: 0.21,
          capUsd: 5,
        })}
      />,
    )
    const region = screen.getByRole('region', { name: 'Generation progress' })
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(region).toHaveTextContent('15 of 41 generated')
    expect(region).toHaveTextContent('Running')
    expect(region).toHaveTextContent(
      '4 generating, 20 queued, 2 failed. Lessons open as soon as they finish. You can close this page; generation keeps going.',
    )
    await expectNoAxeViolations(container)
  })

  it('stopped by the spend cap: explains the counts with the real cap and how to resume', () => {
    const statuses = statusesFor([
      ['generated', [...range(1, 13), ...range(15, 24)]],
      ['failed', [14]],
      ['cancelled', range(25, 41)],
    ])
    render(
      <GenerationSummary
        progress={progressOf(statuses, {
          id: 'run-1',
          status: 'stopped_cap',
          statusLabel: 'stopped: spend cap reached',
          costUsd: 0.29,
          capUsd: 0.25,
        })}
      />,
    )
    const stopped = screen.getByRole('status', { name: 'Generation stopped' })
    expect(stopped).toHaveTextContent('Stopped: spend cap reached')
    expect(stopped).toHaveTextContent(
      '23 of 41 lessons were generated before the run reached its $0.25 cap. No new jobs were started; 17 lessons were not generated and 1 failed. Finished lessons are kept and can be edited.',
    )
    expect(stopped).toHaveTextContent(
      'To finish the unit, an admin raises the cap, then you can resume. Resuming generates only the lessons that are missing.',
    )
  })
})
