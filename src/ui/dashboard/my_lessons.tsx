'use client'

import { useMemo, useState } from 'react'
import type { LessonStatus } from '../../db/schema'
import type { MyLessonsData } from '../../units/dashboard_data'
import { LessonTable, type RowActions } from './lesson_table'
import { StatusChips, type ChipStatus } from './status_chips'

const NO_ACTIONS: RowActions = {
  canGenerate: false,
  canAssign: false,
  promptVersion: 0,
  onRetry: () => {},
  onRegenerate: () => {},
  onAssign: () => {},
  onGenerateFlex: () => {},
}

/** R25 My lessons: the signed-in user's assigned lessons by unit, with status counts as filters. */
export function MyLessons({ data, userName }: { data: MyLessonsData; userName: string }) {
  const [pressed, setPressed] = useState<ChipStatus[]>([])
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const now = useMemo(() => new Date(data.now), [data.now])
  const counts = useMemo(() => {
    const total = {} as Record<LessonStatus, number>
    data.units.forEach((unit) =>
      Object.entries(unit.counts).forEach(([status, n]) => {
        total[status as LessonStatus] = (total[status as LessonStatus] ?? 0) + n
      }),
    )
    return total
  }, [data.units])

  function toggle(status: ChipStatus) {
    setPressed((current) =>
      current.includes(status) ? current.filter((item) => item !== status) : [...current, status],
    )
  }

  function select(ids: string[], on: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)))
      return next
    })
  }

  return (
    <main className="page mine">
      <h1 className="h1">My lessons</h1>
      <p className="sub">Lessons assigned to you, {userName}, across all units.</p>
      {data.units.length === 0 ? (
        <p className="notice info mine-empty">
          No lessons are assigned to you yet. An author or approver assigns them from a unit page.
        </p>
      ) : (
        <StatusChips counts={counts} pressed={pressed} onToggle={toggle} />
      )}
      {data.units.map((unit) => {
        const rows = unit.rows.filter(
          (row) => pressed.length === 0 || (pressed as string[]).includes(row.status),
        )
        return (
          <section key={unit.id} aria-labelledby={`unit-${unit.id}`}>
            <h2 className="h3 tbl-head" id={`unit-${unit.id}`}>
              {unit.heading}
            </h2>
            <LessonTable
              rows={rows}
              arcs={null}
              selected={selected}
              onSelect={select}
              now={now}
              actions={NO_ACTIONS}
            />
          </section>
        )
      })}
    </main>
  )
}
