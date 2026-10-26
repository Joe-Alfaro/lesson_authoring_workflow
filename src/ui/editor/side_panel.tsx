'use client'
// The editor's side panel (mockups R22-alignment-check, R23-history, R14-version-history):
// Alignment (R22, for AI assist users), History (R23) and Versions (R14) tabs. Comments (R26) join
// this tab list later.
import { useId, useRef, type ReactNode } from 'react'
import type { LessonStatus } from '../../db/schema'
import { Icon, type IconName } from '../lesson/lesson_icons'
import { formatWhen } from './format_time'

export interface VersionItem {
  id: string
  createdAt: string
  author: { id: string; name: string } | null
  /** Areas this version changed since the previous one (R14). */
  changes: string[]
  /** Others who edited it besides the author. */
  contributors?: { id: string; name: string }[]
  /** "prompt v3" on a generated version. */
  generatedWith?: string
}

/** One timeline row (src/workflow/timeline.ts): a status change or an assignment. */
export interface HistoryItem {
  id: string
  kind: 'status' | 'assignment'
  /** The status a status event moved to; null for assignments. */
  toStatus: LessonStatus | null
  actor: { name: string } | null
  /** What happened, after the actor's name. */
  text: string
  note: string | null
  at: string
}

export type AlignmentVerdict = 'addressed' | 'partly_addressed' | 'missing'

export interface AlignmentResult {
  checkedAt: string
  standards: {
    code: string
    text: string
    verdict: AlignmentVerdict
    reason: string
    evidence: { id: string; label: string }[]
  }[]
}

export interface AlignmentState {
  result: AlignmentResult | null
  busy: boolean
  error: string | null
}

export type PanelTab = 'alignment' | 'history' | 'versions'

const STATUS_NODES: Record<LessonStatus, { icon: IconName; colour: string }> = {
  generating: { icon: 'sparkle', colour: 'var(--st-gen)' },
  draft: { icon: 'pencil', colour: 'var(--st-draft)' },
  in_review: { icon: 'eye', colour: 'var(--st-review)' },
  changes_requested: { icon: 'pen', colour: 'var(--st-changes)' },
  approved: { icon: 'check', colour: 'var(--st-approved)' },
  failed: { icon: 'warning', colour: 'var(--st-failed)' },
}

const ASSIGNMENT_NODE: { icon: IconName; colour: string } = {
  icon: 'person',
  colour: 'var(--st-none)',
}

const VERDICTS: Record<AlignmentVerdict, { label: string; pill: string; icon: IconName }> = {
  addressed: { label: 'Addressed', pill: 'approved', icon: 'check' },
  partly_addressed: { label: 'Partly addressed', pill: 'review', icon: 'warning' },
  missing: { label: 'Missing', pill: 'failed', icon: 'warning' },
}

function versionLine(version: VersionItem): string {
  if (!version.author) {
    return version.generatedWith
      ? `System. Generated with ${version.generatedWith}`
      : 'System. Generated'
  }
  // Everyone who edited since the previous version (mockup: "Reviewer 03, Reviewer 07. Edited ...").
  const who = [version.author, ...(version.contributors ?? [])]
    .map((person) => person.name)
    .sort((a, b) => a.localeCompare(b))
    .join(', ')
  if (version.changes.length === 0) return `${who}. No content changes`
  return `${who}. Edited ${version.changes.join(', ')}`
}

function minutesAgo(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes === 1) return '1 min ago'
  if (minutes < 60) return `${minutes} min ago`
  return formatWhen(iso)
}

/** Scrolls the live document to a section, part or block and highlights it briefly. */
function jumpTo(id: string) {
  const target =
    document.getElementById(`part-${id}`) ??
    document.querySelector<HTMLElement>(`.doc [data-block-id="${CSS.escape(id)}"]`) ??
    document.querySelector<HTMLElement>(`.doc [data-section-id="${CSS.escape(id)}"]`)
  if (!target) return
  target.scrollIntoView({ behavior: 'smooth', block: 'center' })
  target.classList.remove('jump-flash')
  void target.offsetWidth
  target.classList.add('jump-flash')
}

function AlignmentBody({ state, onCheck }: { state: AlignmentState; onCheck: () => void }) {
  const { result, busy, error } = state
  return (
    <>
      <div className="row">
        <h2 className="h3 panel-title">Standards alignment</h2>
        <span className="spacer" />
        <button type="button" className="btn sm" disabled={busy} onClick={onCheck}>
          <Icon name="refresh" />
          Check again
        </button>
      </div>
      <p className="caption">
        {busy
          ? 'Checking the lesson against the full text of each focus standard.'
          : result
            ? `Checked ${minutesAgo(result.checkedAt)} against the full text of each focus standard.`
            : 'Checks the lesson against the full text of each focus standard.'}{' '}
        The check suggests; it doesn&rsquo;t change the lesson.
      </p>
      {error ? (
        <p className="notice err" role="alert">
          <Icon name="warning" />
          <span>{error}</span>
        </p>
      ) : null}
      {busy && !result ? (
        <div className="progress indet align-progress" role="status" aria-label="Checking">
          <i />
        </div>
      ) : null}
      {result ? (
        <ul className="align-list" aria-busy={busy}>
          {result.standards.map((item) => {
            const verdict = VERDICTS[item.verdict]
            return (
              <li key={item.code}>
                <div className="row">
                  <b>{item.code}</b>
                  <span className="spacer" />
                  <span className={`pill ${verdict.pill}`}>
                    <Icon name={verdict.icon} />
                    {verdict.label}
                  </span>
                </div>
                {item.text ? <p className="std-text">{item.text}</p> : null}
                <p className="reason">{item.reason}</p>
                {item.evidence.length > 0 ? (
                  <div className="chips">
                    {item.evidence.map((evidence) => (
                      <a
                        key={evidence.id}
                        href={`#ev-${evidence.id}`}
                        className="chip sm ev-chip"
                        onClick={(event) => {
                          event.preventDefault()
                          jumpTo(evidence.id)
                        }}
                      >
                        {evidence.label}
                      </a>
                    ))}
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : null}
    </>
  )
}

export function SidePanel({
  tab,
  tabs,
  onTab,
  versions,
  history,
  alignment,
  onCheckAlignment,
  selectedVersion,
  onOpenVersion,
}: {
  tab: PanelTab
  tabs: PanelTab[]
  onTab: (tab: PanelTab) => void
  versions: VersionItem[] | null
  history: HistoryItem[] | null
  alignment: AlignmentState
  onCheckAlignment: () => void
  selectedVersion: string | null
  onOpenVersion: (version: VersionItem) => void
}) {
  const base = useId()
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const labels: Record<PanelTab, string> = {
    alignment: 'Alignment',
    history: 'History',
    versions: 'Versions',
  }

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    const next = (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length
    onTab(tabs[next]!)
    tabRefs.current[next]?.focus()
  }

  let body: ReactNode
  if (tab === 'alignment') {
    body = <AlignmentBody state={alignment} onCheck={onCheckAlignment} />
  } else if (tab === 'versions') {
    body = (
      <>
        <h2 className="h3 panel-title">Versions</h2>
        <p className="caption">
          A version is saved each time edits pause for 30 seconds, and before any regenerate or
          restore.
        </p>
        {versions === null ? (
          <p className="caption">Loading versions…</p>
        ) : versions.length === 0 ? (
          <p className="caption">No versions yet. One is saved when edits pause.</p>
        ) : (
          <ul className="versions">
            {versions.map((version, index) => (
              <li key={version.id} className={version.id === selectedVersion ? 'on' : ''}>
                <button
                  type="button"
                  className="version"
                  aria-current={version.id === selectedVersion ? 'true' : undefined}
                  onClick={() => onOpenVersion(version)}
                >
                  <span className="row">
                    <b>{formatWhen(version.createdAt, { capital: true })}</b>
                    {index === 0 ? <span className="caption current-tag">Current</span> : null}
                  </span>
                  <span className="caption">{versionLine(version)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </>
    )
  } else {
    body = (
      <>
        <h2 className="h3 panel-title">Status history</h2>
        {history === null ? (
          <p className="caption">Loading history…</p>
        ) : history.length === 0 ? (
          <p className="caption">No status changes yet.</p>
        ) : (
          <ol className="tl">
            {[...history].reverse().map((event) => {
              const node = event.toStatus ? STATUS_NODES[event.toStatus] : ASSIGNMENT_NODE
              return (
                <li key={event.id}>
                  <span className="node" style={{ color: node.colour }} aria-hidden="true">
                    <Icon name={node.icon} />
                  </span>
                  <div>
                    <div>
                      <b>{event.actor ? event.actor.name : 'System'}</b> {event.text}
                    </div>
                    <div className="caption">{formatWhen(event.at, { capital: true })}</div>
                    {event.note ? <blockquote className="note">{event.note}</blockquote> : null}
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </>
    )
  }

  return (
    <aside className="side" aria-label="Side panel">
      <div className="tabs" role="tablist" aria-label="Lesson panels">
        {tabs.map((item, index) => (
          <button
            key={item}
            ref={(element) => {
              tabRefs.current[index] = element
            }}
            type="button"
            role="tab"
            id={`${base}-${item}`}
            aria-selected={tab === item}
            aria-controls={`${base}-panel`}
            tabIndex={tab === item ? 0 : -1}
            onClick={() => onTab(item)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {labels[item]}
          </button>
        ))}
      </div>
      <div
        className="sbody"
        role="tabpanel"
        id={`${base}-panel`}
        aria-labelledby={`${base}-${tab}`}
      >
        {body}
      </div>
    </aside>
  )
}
