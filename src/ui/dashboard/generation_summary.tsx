import type { LessonGenerationStatus, UnitProgress } from '../../generation/progress'
import { ErrorIcon } from '../icons'
import { formatUsd } from './format'

const PROGRESS_NOTE =
  'Lessons open as soon as they finish. You can close this page; generation keeps going.'

/** Numbered lessons per generation status; flex days are generated on demand (D-030). */
function numberedCounts(progress: UnitProgress) {
  const numbered = progress.lessons.filter((lesson) => !lesson.isFlex)
  const count = (...statuses: LessonGenerationStatus[]) =>
    numbered.filter((lesson) => statuses.includes(lesson.status)).length
  return {
    total: numbered.length,
    generated: count('generated'),
    generating: count('generating'),
    queued: count('queued'),
    failed: count('failed'),
    notGenerated: count('not_started', 'cancelled'),
  }
}

/** "4 generating, 20 queued, 2 failed." without the zero parts. */
function runningLine(counts: ReturnType<typeof numberedCounts>): string {
  const parts = [
    [counts.generating, 'generating'],
    [counts.queued, 'queued'],
    [counts.failed, 'failed'],
  ].filter(([n]) => n !== 0)
  if (parts.length === 0) {
    return 'Finishing the last lessons.'
  }
  return `${parts.map(([n, word]) => `${n} ${word}`).join(', ')}.`
}

/**
 * The summary at the top of the unit page while there is nothing generated, a run is going, or
 * a run stopped at its spend cap (R9, R12). Counts cover numbered lessons only.
 */
export function GenerationSummary({ progress }: { progress: UnitProgress }) {
  const counts = numberedCounts(progress)
  const run = progress.run

  if (run?.status === 'stopped_cap') {
    const failed = counts.failed > 0 ? ` and ${counts.failed} failed` : ''
    // After an admin raises the cap, capUsd is the new cap, not the one the run stopped at.
    const raised = run.capUsd > run.costUsd
    return (
      <section className="gsum" role="status" aria-label="Generation stopped">
        <div className="row stopped-title">
          <ErrorIcon />
          <span className="bigcount">Stopped: spend cap reached</span>
        </div>
        <p className="stopped-text">
          {counts.generated} of {counts.total} lessons were generated before the run reached its{' '}
          {raised ? 'spend cap' : `${formatUsd(run.capUsd)} cap`}. No new jobs were started;{' '}
          {counts.notGenerated} lessons were not generated{failed}. Finished lessons are kept and
          can be edited.
        </p>
        <p className="sub">
          {raised
            ? `An admin raised the cap to ${formatUsd(run.capUsd)}. Resume generates only the lessons that are missing.`
            : 'To finish the unit, an admin raises the cap, then you can resume. Resuming generates only the lessons that are missing.'}
        </p>
      </section>
    )
  }

  if (run?.status === 'cancelled') {
    const failed = counts.failed > 0 ? ` and ${counts.failed} failed` : ''
    return (
      <section className="gsum" aria-label="Generation progress" aria-live="polite">
        <div className="row">
          <span className="bigcount">
            {counts.generated} of {counts.total} generated
          </span>
          <span className="pill none">Cancelled</span>
        </div>
        <p className="sub">
          The run was cancelled: {counts.notGenerated} lessons were not generated{failed}. Finished
          lessons are kept; generate the rest when you&apos;re ready.
        </p>
      </section>
    )
  }

  if (run?.status === 'queued' || run?.status === 'running') {
    return (
      <section className="gsum" aria-label="Generation progress" aria-live="polite">
        <div className="row">
          <span className="bigcount">
            {counts.generated} of {counts.total} generated
          </span>
          <span className="pill gen">
            <span className="dot breathe" aria-hidden="true" />
            Running
          </span>
        </div>
        <p className="sub">
          {runningLine(counts)} {PROGRESS_NOTE}
        </p>
      </section>
    )
  }

  return (
    <section className="gsum" aria-label="Generation">
      <span className="bigcount">
        {counts.generated} of {counts.total} generated
      </span>
      {counts.generated === 0 ? (
        <p className="sub">
          Nothing has been generated yet. Review the prompt, then start generation.
        </p>
      ) : null}
    </section>
  )
}
