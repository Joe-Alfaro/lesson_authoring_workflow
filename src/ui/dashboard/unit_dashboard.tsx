'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'
import type { Role } from '../../auth/roles'
import type { UnitDashboardData, DashboardRow } from '../../units/dashboard_data'
import { Breadcrumbs } from '../breadcrumbs'
import {
  CheckIcon,
  DownloadIcon,
  PersonIcon,
  PlayIcon,
  RetryIcon,
  StopIcon,
  WarningIcon,
} from '../icons'
import { errorText, sendJson } from './api'
import { AssignPopover, type Reviewer } from './assign_popover'
import { CancelRunDialog } from './cancel_run_dialog'
import { FilterBar, hasFilters, NO_FILTERS, type FilterOption, type Filters } from './filter_bar'
import { formatClock, formatDayTime, formatUsd } from './format'
import { GenerationSummary } from './generation_summary'
import { LessonTable, type RowActions } from './lesson_table'
import { RaiseCapDialog } from './raise_cap_dialog'
import { RegenerateDialog } from './regenerate_dialog'
import { StartGenerationDialog, type StartOptions } from './start_generation_dialog'
import { StatusChips, type ChipStatus } from './status_chips'
import { STATUS_LOOKS, type RowStatus } from './status_pill'
import { UnitStrip, type StripLesson } from './unit_strip'
import { useLiveRefresh } from './use_live_refresh'

type Dialog =
  | { kind: 'start' }
  | { kind: 'cancel' }
  | { kind: 'raise_cap' }
  | { kind: 'regenerate'; rows: DashboardRow[]; error?: string }

/** Where the assign popover is anchored: under the selection bar or a row's menu. */
type AssignTarget = {
  anchor: 'bulk' | HTMLElement | null
  rows: DashboardRow[]
  saving?: boolean
  error?: string
}

const STATUS_FILTERS: RowStatus[] = [
  'not_generated',
  'queued',
  'generating',
  'draft',
  'in_review',
  'changes_requested',
  'approved',
  'failed',
]

function matchesFilters(row: DashboardRow, filters: Filters): boolean {
  const search = filters.search.trim().toLowerCase()
  if (
    search &&
    ![row.title, row.outlineLine, row.lessonType, String(row.lessonNumber ?? '')].some((text) =>
      text.toLowerCase().includes(search),
    )
  ) {
    return false
  }
  if (filters.statuses.length > 0 && !filters.statuses.includes(row.status)) {
    return false
  }
  if (filters.arcs.length > 0 && !filters.arcs.includes(row.arcId ?? '')) {
    return false
  }
  if (filters.assignees.length > 0) {
    const assignee = row.assignee?.id ?? 'unassigned'
    if (!filters.assignees.includes(assignee)) {
      return false
    }
  }
  return true
}

function lessonsText(count: number): string {
  return count === 1 ? '1 lesson' : `${count} lessons`
}

/**
 * The unit page (R6, R9-R12, R24, R25): header actions, the generation or review summary with
 * the unit strip and cost panel, filters, bulk actions and the lesson table. Server data
 * arrives as props and is re-read live while generation runs.
 */
export function UnitDashboard({ data, role }: { data: UnitDashboardData; role: Role }) {
  const router = useRouter()
  const { run, progress, rows } = data
  const active = run?.status === 'queued' || run?.status === 'running'
  const stopped = run?.status === 'stopped_cap'
  // A run stopped at its cap waits for an admin, who may raise the cap from another browser.
  useLiveRefresh(data.unit.id, active || stopped)

  const canGenerate = role === 'author' || role === 'admin'
  const canAssign = role === 'author' || role === 'approver' || role === 'admin'
  const isAdmin = role === 'admin'
  const now = useMemo(() => new Date(data.now), [data.now])

  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [assign, setAssign] = useState<AssignTarget | null>(null)
  const [busy, setBusy] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)

  const numbered = rows.filter((row) => row.lessonNumber !== null)
  const visible = rows.filter((row) => matchesFilters(row, filters))
  // Rows that left the table (filtered out, or gone) don't stay selected.
  const selectedRows = rows.filter((row) => selected.has(row.id))
  // What "Retry N failed" regenerates: lessons in the Failed status (the service's `failed: true`).
  const failedRows = rows.filter((row) => row.status === 'failed')
  // Lessons never generated; failed ones have their own Retry.
  const missing = numbered.filter(
    (row) =>
      !row.hasContent && (row.generation === 'not_started' || row.generation === 'cancelled'),
  )
  const anyContent = rows.some((row) => row.hasContent)
  // A run cancelled before every lesson was generated keeps the generation summary.
  const cancelledEarly = run?.status === 'cancelled' && missing.length > 0
  const [defaultModel] = data.models
  const perLessonUsd = defaultModel?.perLessonUsd ?? 0
  const promptHref = `/units/${data.unit.id}/prompt`
  const counts = useMemo(() => {
    const numberedProgress = progress.lessons.filter((lesson) => !lesson.isFlex)
    const count = (status: string) =>
      numberedProgress.filter((lesson) => lesson.status === status).length
    return {
      queued: count('queued'),
      generating: count('generating'),
      generated: count('generated'),
    }
  }, [progress])

  const refresh = useCallback(() => router.refresh(), [router])

  const closeDialog = useCallback(() => {
    setDialog(null)
    setStartError(null)
  }, [])
  const closeAssign = useCallback(() => setAssign(null), [])

  function select(ids: string[], on: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)))
      return next
    })
  }

  async function call(url: string, body: unknown, method: 'POST' | 'PUT' = 'POST') {
    setBusy(true)
    try {
      return await sendJson(url, method, body)
    } finally {
      setBusy(false)
    }
  }

  async function start(options: StartOptions) {
    const lessonIds =
      options.scope === 'selected'
        ? selectedRows.filter((row) => row.lessonNumber !== null).map((row) => row.id)
        : missing.length === numbered.length
          ? undefined
          : missing.map((row) => row.id)
    const result = await call(`/api/units/${data.unit.id}/generation/runs`, {
      model: options.model,
      lessonIds,
    })
    if (!result.ok) {
      setStartError(
        result.body.reason === 'human_edits'
          ? 'Some selected lessons have human edits. Regenerate them from the table, which asks before replacing them.'
          : errorText(result),
      )
      return
    }
    setDialog(null)
    setSelected(new Set())
    refresh()
  }

  /** Sends a regenerate request; lessons with human edits come back for confirmation. */
  async function regenerate(body: { lessonIds?: string[]; failed?: true }, confirm: boolean) {
    const result = await call(`/api/units/${data.unit.id}/generation/regenerate`, {
      ...body,
      confirmOverwrite: confirm,
    })
    if (result.ok) {
      setDialog(null)
      setSelected(new Set())
      refresh()
      return
    }
    if (result.body.reason === 'human_edits') {
      const ids = body.failed ? failedRows.map((row) => row.id) : (body.lessonIds ?? [])
      setDialog({ kind: 'regenerate', rows: rows.filter((row) => ids.includes(row.id)) })
      return
    }
    if (dialog?.kind === 'regenerate') {
      setDialog({ ...dialog, error: errorText(result) })
    } else {
      setPageError(errorText(result))
    }
  }

  async function cancelRun() {
    if (!run) {
      return
    }
    const result = await call(`/api/generation/runs/${run.id}/cancel`, {})
    if (!result.ok) {
      setPageError(errorText(result))
    }
    setDialog(null)
    refresh()
  }

  async function resume() {
    if (!run) {
      return
    }
    const result = await call(`/api/generation/runs/${run.id}/resume`, {})
    if (!result.ok) {
      setPageError(errorText(result))
    }
    refresh()
  }

  async function generateFlex(row: DashboardRow) {
    const result = await call(`/api/lessons/${row.id}/generate`, {})
    if (!result.ok) {
      setPageError(errorText(result))
    }
    refresh()
  }

  async function assignTo(reviewer: Reviewer) {
    if (!assign) {
      return
    }
    // The list stays open (and busy) until the assignment is saved.
    setAssign({ ...assign, saving: true, error: undefined })
    const result = await call('/api/lessons/assign', {
      lessonIds: assign.rows.map((row) => row.id),
      assigneeId: reviewer.id,
    })
    if (!result.ok) {
      setAssign({ ...assign, saving: false, error: errorText(result) })
      return
    }
    setAssign(null)
    if (assign.anchor === 'bulk') {
      setSelected(new Set())
    }
    refresh()
  }

  const actions: RowActions = {
    canGenerate,
    canAssign,
    promptVersion: data.prompt.version,
    onRetry: (row) => void regenerate({ lessonIds: [row.id] }, false),
    onRegenerate: (row) => setDialog({ kind: 'regenerate', rows: [row] }),
    // The row menu has just returned focus to its button: the list opens under it.
    onAssign: (row) =>
      setAssign({
        anchor: document.activeElement instanceof HTMLElement ? document.activeElement : null,
        rows: [row],
      }),
    onGenerateFlex: (row) => void generateFlex(row),
  }

  function assignPopover(target: AssignTarget) {
    const only = target.rows.length === 1 ? target.rows[0] : undefined
    return (
      <AssignPopover
        title={
          only?.lessonNumber != null
            ? `Assign lesson ${only.lessonNumber}`
            : `Assign ${lessonsText(target.rows.length)}`
        }
        lessonCount={target.rows.length}
        onAssign={(reviewer) => void assignTo(reviewer)}
        onClose={closeAssign}
        saving={target.saving}
        error={target.error}
        anchor={target.anchor === 'bulk' ? undefined : target.anchor}
      />
    )
  }

  const stripLessons: StripLesson[] = numbered.map((row) => ({
    id: row.id,
    lessonNumber: row.lessonNumber!,
    arcId: row.arcId,
    status: row.status,
  }))
  const strip = <UnitStrip arcs={data.arcs} lessons={stripLessons} />
  const approved = data.counts.approved
  const showTable = !data.complete || hasFilters(filters)
  const pressed = filters.statuses as ChipStatus[]
  function toggleChip(status: ChipStatus) {
    setFilters((current) => ({
      ...current,
      statuses: current.statuses.includes(status)
        ? current.statuses.filter((item) => item !== status)
        : [...current.statuses, status],
    }))
  }
  const retryFailed =
    canGenerate && failedRows.length > 0 ? (
      <button
        type="button"
        className="btn sm"
        disabled={busy}
        onClick={() => void regenerate({ failed: true }, false)}
      >
        <RetryIcon />
        Retry {failedRows.length} failed
      </button>
    ) : null

  const statusOptions: FilterOption[] = STATUS_FILTERS.filter((status) =>
    rows.some((row) => row.status === status),
  ).map((status) => ({ value: status, label: STATUS_LOOKS[status].label }))
  const arcOptions: FilterOption[] = data.arcs.map((arc) => ({ value: arc.id, label: arc.name }))
  const assigneeOptions: FilterOption[] = [
    { value: 'unassigned', label: 'Unassigned' },
    ...[
      ...new Map(
        rows.flatMap((row) => (row.assignee ? [[row.assignee.id, row.assignee.name]] : [])) as [
          string,
          string,
        ][],
      ),
    ]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, label]) => ({ value, label })),
  ]

  return (
    <main className="page dash">
      <Breadcrumbs
        trail={[{ label: 'Units', href: '/units' }, { label: `Unit ${data.unit.unitNumber}` }]}
      />
      <div className="uhead">
        <div>
          <h1 className="h1">{data.unit.heading}</h1>
          <p className="sub">
            <span className="long">{data.unit.summary}</span>
            <span className="short">{data.unit.shortSummary}</span>
          </p>
        </div>
        <span className="spacer" />
        {canGenerate ? (
          <Link className="btn" href={promptHref}>
            Edit prompt
          </Link>
        ) : null}
        {canGenerate && active ? (
          <button
            type="button"
            className="btn danger"
            onClick={() => setDialog({ kind: 'cancel' })}
          >
            <StopIcon />
            Cancel run
          </button>
        ) : null}
        {canGenerate && stopped ? (
          <button
            type="button"
            className="btn primary"
            disabled={busy || !run || run.capUsd <= run.costUsd}
            onClick={() => void resume()}
          >
            <PlayIcon />
            Resume generation
          </button>
        ) : null}
        {canGenerate && !active && !stopped && missing.length > 0 ? (
          <button
            type="button"
            className="btn primary"
            onClick={() => setDialog({ kind: 'start' })}
          >
            <PlayIcon />
            Generate lessons...
          </button>
        ) : null}
        {anyContent && !active && !stopped ? (
          <button type="button" className="btn" disabled title="Export arrives with R16">
            <DownloadIcon />
            Export
          </button>
        ) : null}
      </div>

      {pageError ? (
        <p className="notice err" role="alert">
          <WarningIcon />
          <span>{pageError}</span>
        </p>
      ) : null}

      {data.eldWarnings.length > 0 ? (
        <section className="notice warn" aria-labelledby="eld-warnings">
          <WarningIcon />
          <div>
            <b id="eld-warnings">
              {data.eldWarnings.length === 1
                ? "1 ELD row didn't match a lesson."
                : `${data.eldWarnings.length} ELD rows didn't match a lesson.`}
            </b>{' '}
            They add nothing to the generation input.
            <ul>
              {data.eldWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {!run || active || stopped || cancelledEarly ? (
        <div className={`panel runp${stopped ? ' stopped' : ''}`}>
          <div className="l">
            <GenerationSummary progress={progress} />
            {strip}
          </div>
          <div className="r">
            <dl className="kv">
              {run ? (
                <>
                  <dt>Running cost</dt>
                  <dd>{formatUsd(run.costUsd)}</dd>
                  {active ? (
                    <>
                      <dt>Estimate for run</dt>
                      <dd>{formatUsd(run.estimateUsd)}</dd>
                    </>
                  ) : null}
                  <dt>Spend cap</dt>
                  <dd>{formatUsd(run.capUsd)}</dd>
                  <dt>Model</dt>
                  <dd>{run.modelLabel}</dd>
                  <dt>Prompt</dt>
                  <dd>v{run.promptVersion}</dd>
                  {active ? (
                    <>
                      <dt>Started</dt>
                      <dd suppressHydrationWarning>
                        {[run.startedBy, formatClock(new Date(run.createdAt))]
                          .filter(Boolean)
                          .join(', ')}
                      </dd>
                    </>
                  ) : (
                    <>
                      <dt>{stopped ? 'Stopped' : 'Cancelled'}</dt>
                      <dd suppressHydrationWarning>
                        {run.finishedAt ? formatClock(new Date(run.finishedAt)) : '–'}
                      </dd>
                    </>
                  )}
                </>
              ) : (
                <>
                  <dt>Prompt</dt>
                  <dd>v{data.prompt.version}</dd>
                  <dt>Model</dt>
                  <dd>{defaultModel?.label}</dd>
                  <dt>Spend cap</dt>
                  <dd>{formatUsd(data.settings.capUsd)}</dd>
                </>
              )}
            </dl>
            {active || cancelledEarly ? retryFailed : null}
            {stopped && isAdmin ? (
              <button
                type="button"
                className="btn sm"
                onClick={() => setDialog({ kind: 'raise_cap' })}
              >
                Raise cap...
              </button>
            ) : null}
          </div>
        </div>
      ) : data.complete ? (
        <>
          <section className="complete" role="status">
            <span className="seal">
              <CheckIcon />
            </span>
            <div>
              <div className="bigcount">Unit complete: all {data.total} lessons approved</div>
              <p>
                Approved lessons are locked. An approver can reopen a lesson if it needs another
                change.
              </p>
            </div>
            <div className="row">
              <button type="button" className="btn" disabled title="Export arrives with R16">
                <DownloadIcon />
                Download unit JSON
              </button>
              <button type="button" className="btn" disabled title="Export arrives with R16">
                <DownloadIcon />
                Download unit HTML
              </button>
            </div>
          </section>
          <section className="panel reviewp" aria-label="Review progress">
            <StatusChips counts={data.counts} pressed={pressed} onToggle={toggleChip} />
            {strip}
          </section>
        </>
      ) : (
        <section className="panel reviewp" aria-label="Review progress">
          <div className="row">
            <span className="bigcount">
              {approved} of {data.total} approved
            </span>
            <span className="spacer" />
            {run ? (
              <span className="caption" suppressHydrationWarning>
                Generation {run.status === 'cancelled' ? 'cancelled' : 'finished'} at{' '}
                {run.finishedAt ? formatClock(new Date(run.finishedAt)) : '–'} with prompt v
                {run.promptVersion}. Run cost {formatUsd(run.costUsd)}.
              </span>
            ) : null}
            {retryFailed}
          </div>
          <StatusChips counts={data.counts} pressed={pressed} onToggle={toggleChip} />
          {strip}
        </section>
      )}

      {/* R24-dashboard-complete ends after the strip panel; a count chip brings the table back. */}
      {showTable ? (
        <>
          <FilterBar
            filters={filters}
            onChange={setFilters}
            statusOptions={statusOptions}
            arcOptions={arcOptions}
            assigneeOptions={assigneeOptions}
          />

          {selectedRows.length > 0 ? (
            <div className="selbar-wrap">
              <div className="selbar" role="toolbar" aria-label="Bulk actions">
                <b>{lessonsText(selectedRows.length)} selected</b>
                <span className="spacer" />
                {canAssign ? (
                  <button
                    type="button"
                    className="btn sm"
                    aria-haspopup="dialog"
                    aria-expanded={assign?.anchor === 'bulk'}
                    onClick={() =>
                      setAssign(
                        assign?.anchor === 'bulk' ? null : { anchor: 'bulk', rows: selectedRows },
                      )
                    }
                  >
                    <PersonIcon />
                    Assign
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn sm"
                  disabled={!canGenerate}
                  title={canGenerate ? undefined : 'Only authors regenerate lessons.'}
                  onClick={() =>
                    setDialog({
                      kind: 'regenerate',
                      rows: selectedRows.filter((row) => row.lessonNumber !== null),
                    })
                  }
                >
                  <RetryIcon />
                  Regenerate
                </button>
                <button type="button" className="btn sm" onClick={() => setSelected(new Set())}>
                  Clear
                </button>
              </div>
              {assign?.anchor === 'bulk' ? assignPopover(assign) : null}
            </div>
          ) : null}

          <LessonTable
            rows={visible}
            arcs={data.arcs}
            selected={selected}
            onSelect={select}
            now={now}
            actions={actions}
          />
          {assign && assign.anchor !== 'bulk' ? assignPopover(assign) : null}
        </>
      ) : null}

      {dialog?.kind === 'start' ? (
        <StartGenerationDialog
          lessonCount={missing.length}
          modelLabel={defaultModel?.label ?? ''}
          promptVersion={data.prompt.version}
          promptHref={promptHref}
          estimatedUsd={perLessonUsd * missing.length}
          capUsd={data.settings.capUsd}
          concurrency={data.settings.concurrency}
          models={data.models.map((model) => ({
            id: model.id,
            label: model.label,
            estimatedUsd: model.perLessonUsd * missing.length,
          }))}
          scopeLabel={
            missing.length === numbered.length
              ? undefined
              : `The ${lessonsText(missing.length)} not generated yet`
          }
          selectedCount={selectedRows.filter((row) => row.lessonNumber !== null).length}
          promptSaved={`saved ${data.prompt.savedBy ? `by ${data.prompt.savedBy} ` : ''}${formatDayTime(new Date(data.prompt.savedAt), now)}`}
          error={startError}
          busy={busy}
          onStart={(options) => void start(options)}
          onClose={closeDialog}
        />
      ) : null}
      {dialog?.kind === 'cancel' ? (
        <CancelRunDialog
          queued={counts.queued}
          generating={counts.generating}
          generated={counts.generated}
          busy={busy}
          onConfirm={() => void cancelRun()}
          onClose={closeDialog}
        />
      ) : null}
      {dialog?.kind === 'regenerate' ? (
        <RegenerateDialog
          lessonNumbers={dialog.rows.flatMap((row) => row.lessonNumber ?? [])}
          editedLessonNumbers={dialog.rows
            .filter((row) => row.humanEdits)
            .flatMap((row) => row.lessonNumber ?? [])}
          promptVersion={data.prompt.version}
          estimatedUsd={perLessonUsd * dialog.rows.length}
          busy={busy}
          error={dialog.error}
          onConfirm={() => void regenerate({ lessonIds: dialog.rows.map((row) => row.id) }, true)}
          onClose={closeDialog}
        />
      ) : null}
      {dialog?.kind === 'raise_cap' && run ? (
        <RaiseCapDialog
          runId={run.id}
          capUsd={run.capUsd}
          costUsd={run.costUsd}
          globalCapUsd={data.budget.globalCapUsd}
          remainingUsd={data.budget.remainingUsd}
          onSaved={() => {
            setDialog(null)
            refresh()
          }}
          onClose={closeDialog}
        />
      ) : null}
    </main>
  )
}
