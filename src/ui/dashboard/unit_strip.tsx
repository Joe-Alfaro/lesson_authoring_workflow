'use client'

import { useEffect, useRef, useState } from 'react'
import { STATUS_LOOKS, type RowStatus } from './status_pill'

export interface StripLesson {
  id: string
  lessonNumber: number
  arcId: string | null
  status: RowStatus
}

const FINISHED: RowStatus[] = ['draft', 'failed']
const RING_MS = 900

/**
 * The unit strip (STYLE.md): one numbered tile per lesson, grouped by arc and coloured by
 * status. A tile that just finished gets a ring once.
 */
export function UnitStrip({
  arcs,
  lessons,
}: {
  arcs: { id: string; name: string }[]
  lessons: StripLesson[]
}) {
  const previous = useRef(new Map<string, RowStatus>())
  const [ringed, setRinged] = useState<ReadonlySet<string>>(new Set())

  useEffect(() => {
    const finished = lessons.filter((lesson) => {
      const before = previous.current.get(lesson.id)
      return before !== undefined && before !== lesson.status && FINISHED.includes(lesson.status)
    })
    previous.current = new Map(lessons.map((lesson) => [lesson.id, lesson.status]))
    if (finished.length === 0) {
      return
    }
    setRinged(new Set(finished.map((lesson) => lesson.id)))
    const timer = setTimeout(() => setRinged(new Set()), RING_MS)
    return () => clearTimeout(timer)
  }, [lessons])

  const groups = arcs
    .map((arc) => ({ arc, lessons: lessons.filter((lesson) => lesson.arcId === arc.id) }))
    .filter((group) => group.lessons.length > 0)
  const loose = lessons.filter((lesson) => !arcs.some((arc) => arc.id === lesson.arcId))
  if (loose.length > 0) {
    groups.push({ arc: { id: 'none', name: 'No arc' }, lessons: loose })
  }

  return (
    <div className="strip">
      {groups.map(({ arc, lessons: arcLessons }) => (
        <div className="arcgrp" key={arc.id}>
          <div className="arcname">{arc.name}</div>
          <div className="tiles">
            {arcLessons.map((lesson) => {
              const look = STATUS_LOOKS[lesson.status]
              const name = `Lesson ${lesson.lessonNumber}, ${look.label}`
              return (
                <span
                  key={lesson.id}
                  className={`tile ${look.tone}${ringed.has(lesson.id) ? ' just' : ''}`}
                  role="img"
                  aria-label={name}
                  title={`Lesson ${lesson.lessonNumber}: ${look.label}`}
                >
                  {lesson.lessonNumber}
                </span>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
