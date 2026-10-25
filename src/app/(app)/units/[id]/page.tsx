import { notFound } from 'next/navigation'
import { Fragment } from 'react'
import { getDb } from '../../../../db/client'
import { WarningIcon } from '../../../../ui/icons'
import { bannerAuthor } from '../../../../units/banner'
import { getUnitOverview, type UnitLessonRow } from '../../../../units/queries'
import { Breadcrumbs } from '../../../../ui/breadcrumbs'

export const dynamic = 'force-dynamic'

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

function firstLine(text: string): string {
  return text.split('\n')[0]?.trim() ?? ''
}

/**
 * A unit after import: its summary, the ELD rows that matched no lesson (R5) and its lessons by
 * arc. The full dashboard (R24) builds on this page.
 */
export default async function UnitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const unit = await getUnitOverview(getDb(), id)
  if (!unit) {
    notFound()
  }
  const numbered = unit.lessons.filter((lesson) => !lesson.isFlex)
  const flexDays = unit.lessons.length - numbered.length
  const author = bannerAuthor(unit.banner)
  const anchorDetails = [author && `Anchor text by ${author}`, unit.isbn && `ISBN ${unit.isbn}`]
    .filter(Boolean)
    .join(', ')
  const byArc = unit.arcs.map((arc) => ({
    arc,
    lessons: numbered.filter((lesson) => lesson.arcName === arc),
  }))

  return (
    <main className="page unit-page">
      <Breadcrumbs
        trail={[{ label: 'Units', href: '/units' }, { label: `Unit ${unit.unitNumber}` }]}
      />
      <h1 className="h1">
        Unit {unit.unitNumber}: {unit.anchorTextTitle}
      </h1>
      <p className="sub unit-sum">
        Grade {unit.grade}, {plural(numbered.length, 'lesson', 'lessons')} in{' '}
        {plural(unit.arcs.length, 'arc', 'arcs')}, {plural(flexDays, 'flex day', 'flex days')}.
        {anchorDetails ? ` ${anchorDetails}.` : ''}
      </p>

      {unit.eldWarnings.length > 0 ? (
        <section className="notice warn" aria-labelledby="eld-warnings">
          <WarningIcon />
          <div>
            <b id="eld-warnings">
              {plural(unit.eldWarnings.length, 'ELD row', 'ELD rows')} didn&apos;t match a lesson.
            </b>{' '}
            They add nothing to the generation input.
            <ul>
              {unit.eldWarnings.map((warning) => (
                <li key={warning.message}>{warning.message}</li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      <div className="panel">
        <table className="table">
          <thead>
            <tr>
              <th className="n">#</th>
              <th>Lesson</th>
              <th>Type</th>
            </tr>
          </thead>
          <tbody>
            {byArc.map(({ arc, lessons }) => (
              <Fragment key={arc}>
                <tr className="arc">
                  <td colSpan={3}>{arc}</td>
                </tr>
                {lessons.map((lesson: UnitLessonRow) => (
                  <tr key={lesson.id}>
                    <td className="n">{lesson.lessonNumber}</td>
                    <td className="title">{firstLine(lesson.description)}</td>
                    <td>{lesson.lessonType}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  )
}
