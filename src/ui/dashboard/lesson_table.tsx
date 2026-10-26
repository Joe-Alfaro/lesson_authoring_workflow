'use client'

import Link from 'next/link'
import { Fragment, useEffect, useRef } from 'react'
import type { DashboardRow } from '../../units/dashboard_data'
import { Who } from '../avatar'
import { download, lessonExportHref } from '../download'
import {
  DownloadIcon,
  EyeIcon,
  HistoryIcon,
  PencilIcon,
  PersonIcon,
  PlayIcon,
  RetryIcon,
} from '../icons'
import { LocalTime } from '../local_time'
import { formatUpdated } from './format'
import { RowMenu, type MenuEntry } from './row_menu'
import { StatusPill } from './status_pill'

export interface RowActions {
  canGenerate: boolean
  canAssign: boolean
  promptVersion: number
  onRetry: (row: DashboardRow) => void
  onRegenerate: (row: DashboardRow) => void
  onAssign: (row: DashboardRow) => void
  onGenerateFlex: (row: DashboardRow) => void
}

interface LessonTableProps {
  rows: DashboardRow[]
  /** Group rows under arc header rows, in this order; null lists them ungrouped. */
  arcs: { id: string; name: string }[] | null
  selected: ReadonlySet<string>
  onSelect: (ids: string[], selected: boolean) => void
  now: Date
  actions: RowActions
}

function rowName(row: DashboardRow): string {
  return row.lessonNumber === null ? `flex day "${row.outlineLine}"` : `lesson ${row.lessonNumber}`
}

function menuEntries(row: DashboardRow, actions: RowActions): MenuEntry[] {
  const href = `/lessons/${row.id}`
  const noContent = !row.hasContent
  const entries: MenuEntry[] = [
    { kind: 'link', label: 'Open in editor', href, icon: <PencilIcon />, disabled: noContent },
    {
      kind: 'link',
      label: 'Open lesson view',
      href: `${href}/view`,
      icon: <EyeIcon />,
      disabled: noContent,
    },
  ]
  if (actions.canAssign) {
    entries.push({
      kind: 'action',
      label: 'Assign...',
      icon: <PersonIcon />,
      onSelect: () => actions.onAssign(row),
    })
  }
  entries.push({
    kind: 'link',
    label: 'Version history',
    href: `${href}?panel=versions`,
    icon: <HistoryIcon />,
    disabled: noContent,
  })
  entries.push({ kind: 'separator' })
  if (actions.canGenerate && row.lessonNumber !== null) {
    entries.push({
      kind: 'action',
      label: `Regenerate with prompt v${actions.promptVersion}...`,
      icon: <RetryIcon />,
      onSelect: () => actions.onRegenerate(row),
      disabled: row.status === 'queued' || row.status === 'generating',
    })
  }
  // R16: the routes answer 409 without content, so the items are off for those rows.
  entries.push(
    {
      kind: 'action',
      label: 'Download JSON',
      icon: <DownloadIcon />,
      onSelect: () => download(lessonExportHref(row.id, 'json')),
      disabled: noContent,
    },
    {
      kind: 'action',
      label: 'Download HTML',
      icon: <DownloadIcon />,
      onSelect: () => download(lessonExportHref(row.id, 'html')),
      disabled: noContent,
    },
  )
  return entries
}

function SelectAll({
  rows,
  selected,
  onSelect,
}: Pick<LessonTableProps, 'rows' | 'selected' | 'onSelect'>) {
  const ref = useRef<HTMLInputElement>(null)
  const ids = rows.map((row) => row.id)
  const count = ids.filter((id) => selected.has(id)).length
  const all = ids.length > 0 && count === ids.length
  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = count > 0 && !all
    }
  }, [count, all])
  return (
    <input
      ref={ref}
      type="checkbox"
      className="check"
      aria-label="Select all lessons"
      checked={all}
      onChange={() => onSelect(ids, !all)}
    />
  )
}

function LessonRow({
  row,
  selected,
  onSelect,
  now,
  actions,
}: {
  row: DashboardRow
  selected: boolean
  onSelect: LessonTableProps['onSelect']
  now: Date
  actions: RowActions
}) {
  const showTime = row.hasContent || row.status === 'failed'
  const busy = row.status === 'queued' || row.status === 'generating'
  return (
    <tr className={`lrow${selected ? ' sel' : ''}`}>
      <td className="selc">
        <input
          type="checkbox"
          className="check"
          aria-label={
            row.lessonNumber === null
              ? `Select ${rowName(row)}`
              : `Select lesson ${row.lessonNumber}`
          }
          checked={selected}
          onChange={() => onSelect([row.id], !selected)}
        />
      </td>
      <td className="n">{row.lessonNumber ?? <span className="caption">Flex</span>}</td>
      <td className="lesson">
        {row.hasContent ? (
          <Link className="title" href={`/lessons/${row.id}`}>
            {row.title}
          </Link>
        ) : (
          <span className="title">{row.title}</span>
        )}
        {row.title !== row.outlineLine ? <div className="caption">{row.outlineLine}</div> : null}
        {row.error ? <div className="err-line">{row.error}</div> : null}
        {row.stoppedByCap ? (
          <div className="caption">Not started: the spend cap stopped the run.</div>
        ) : null}
      </td>
      <td className="type desc">{row.lessonType}</td>
      <td className="status">
        <StatusPill status={row.status} />
      </td>
      <td className="assignee">
        {row.assignee ? <Who person={row.assignee} /> : <span className="muted">Unassigned</span>}
      </td>
      <td className="editor">
        {row.lastEditor ? <Who person={row.lastEditor} /> : <span className="muted">–</span>}
      </td>
      <td className="num updated">
        {showTime ? (
          <LocalTime iso={row.updatedAt} format={(iso) => formatUpdated(new Date(iso), now)} />
        ) : (
          <span className="muted">–</span>
        )}
      </td>
      <td className="actcell">
        {actions.canGenerate && row.generation === 'failed' ? (
          <button type="button" className="btn sm" onClick={() => actions.onRetry(row)}>
            <RetryIcon />
            Retry
          </button>
        ) : null}
        {actions.canGenerate && row.lessonNumber === null && !row.hasContent && !busy ? (
          <button type="button" className="btn sm" onClick={() => actions.onGenerateFlex(row)}>
            <PlayIcon />
            Generate
          </button>
        ) : null}
      </td>
      <td className="actcell more">
        <RowMenu label={`More actions for ${rowName(row)}`} entries={menuEntries(row, actions)} />
      </td>
    </tr>
  )
}

/**
 * The lesson table (R24): select, #, lesson, type, status, assignee, last edited by, updated,
 * row action and the more menu, grouped by arc. At narrow widths the rows stack (CSS).
 */
export function LessonTable({ rows, arcs, selected, onSelect, now, actions }: LessonTableProps) {
  const groups =
    arcs === null
      ? [{ id: 'all', name: null, rows }]
      : [
          ...arcs.map((arc) => ({
            id: arc.id,
            name: arc.name as string | null,
            rows: rows.filter((row) => row.arcId === arc.id),
          })),
          { id: 'none', name: 'No arc', rows: rows.filter((row) => row.arcId === null) },
        ].filter((group) => group.rows.length > 0)

  return (
    <div className="panel ltable-wrap">
      <table className="table ltable">
        <thead>
          <tr>
            <th className="selc">
              <SelectAll rows={rows} selected={selected} onSelect={onSelect} />
            </th>
            <th className="n">#</th>
            <th>Lesson</th>
            <th>Type</th>
            <th>Status</th>
            <th>Assignee</th>
            <th>Last edited by</th>
            <th>Updated</th>
            <th className="actcell">
              <span className="sr">Action</span>
            </th>
            <th className="actcell">
              <span className="sr">More</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <Fragment key={group.id}>
              {group.name ? (
                <tr className="arc">
                  <th colSpan={10} scope="colgroup">
                    {group.name}
                  </th>
                </tr>
              ) : null}
              {group.rows.map((row) => (
                <LessonRow
                  key={row.id}
                  row={row}
                  selected={selected.has(row.id)}
                  onSelect={onSelect}
                  now={now}
                  actions={actions}
                />
              ))}
            </Fragment>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={10} className="empty-row">
                No lessons match these filters.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  )
}
