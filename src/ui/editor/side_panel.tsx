'use client'
// The editor's side panel (mockup R14-version-history): Versions (R14) and History (R23) tabs.
// The AI assist tabs (Alignment, R22) and Comments (R26) join this tab list in later milestones.
import { useId, useRef, type ReactNode } from 'react'
import { STATUS_LABELS } from '../../workflow/transitions'
import type { LessonStatus } from '../../db/schema'
import { formatWhen } from './format_time'

export interface VersionItem {
  id: string
  createdAt: string
  author: { id: string; name: string } | null
}

export interface HistoryItem {
  id: string
  fromStatus: LessonStatus | null
  toStatus: LessonStatus
  actor: { name: string } | null
  note: string | null
  at: string
}

export type PanelTab = 'versions' | 'history'

const TABS: { id: PanelTab; label: string }[] = [
  { id: 'history', label: 'History' },
  { id: 'versions', label: 'Versions' },
]

export function SidePanel({
  tab,
  onTab,
  versions,
  history,
  selectedVersion,
  onOpenVersion,
}: {
  tab: PanelTab
  onTab: (tab: PanelTab) => void
  versions: VersionItem[] | null
  history: HistoryItem[] | null
  selectedVersion: string | null
  onOpenVersion: (version: VersionItem) => void
}) {
  const base = useId()
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    const next = (index + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length
    onTab(TABS[next]!.id)
    tabRefs.current[next]?.focus()
  }

  let body: ReactNode
  if (tab === 'versions') {
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
            {versions.map((version) => (
              <li key={version.id} className={version.id === selectedVersion ? 'on' : ''}>
                <button
                  type="button"
                  className="version"
                  aria-current={version.id === selectedVersion ? 'true' : undefined}
                  onClick={() => onOpenVersion(version)}
                >
                  <b>{formatWhen(version.createdAt, { capital: true })}</b>
                  <span className="caption">
                    {version.author ? version.author.name : 'System'}
                    {version.author ? '' : '. Generated'}
                  </span>
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
        <h2 className="h3 panel-title">History</h2>
        {history === null ? (
          <p className="caption">Loading history…</p>
        ) : history.length === 0 ? (
          <p className="caption">No status changes yet.</p>
        ) : (
          <ol className="tl">
            {[...history].reverse().map((event) => (
              <li key={event.id}>
                <span className="node" aria-hidden="true" />
                <div>
                  <div>
                    <b>{STATUS_LABELS[event.toStatus]}</b>
                    <span className="caption">
                      {' '}
                      {event.actor ? event.actor.name : 'System'}, {formatWhen(event.at)}
                    </span>
                  </div>
                  {event.note ? <div className="note">“{event.note}”</div> : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </>
    )
  }

  return (
    <aside className="side" aria-label="Side panel">
      <div className="tabs" role="tablist" aria-label="Lesson panels">
        {TABS.map((item, index) => (
          <button
            key={item.id}
            ref={(element) => {
              tabRefs.current[index] = element
            }}
            type="button"
            role="tab"
            id={`${base}-${item.id}`}
            aria-selected={tab === item.id}
            aria-controls={`${base}-panel`}
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => onTab(item.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {item.label}
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
