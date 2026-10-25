'use client'

import Link from 'next/link'
import { Fragment, useEffect, useRef } from 'react'
import type { EldPreview, ImportPreview, PreviewItem } from '../../import/import_service'
import { bannerAuthor } from '../../units/banner'
import { ErrorIcon, WarningIcon } from '../icons'

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many
}

/**
 * True when the cell was rewritten to get the codes (R3), e.g. "RL.6.1, 6.2 L.6.4" yields
 * RL.6.2, which isn't written in full; then the preview shows the text it was read from.
 */
function wasNormalized(item: PreviewItem): boolean {
  const written = new Set(item.focusStandardsText.split(/[\s,;]+/).filter(Boolean))
  return item.focusStandards.some((code) => !written.has(code))
}

function unknownCodes(item: PreviewItem): string[] {
  return [...new Set(item.warnings.flatMap((warning) => (warning.code ? [warning.code] : [])))]
}

function LessonRow({ item }: { item: PreviewItem }) {
  const unknown = unknownCodes(item)
  const otherWarnings = item.warnings.filter((warning) => !warning.code)
  const flagged = unknown.length > 0 || otherWarnings.length > 0
  return (
    <tr className={flagged ? 'hl' : undefined}>
      <td className="n">{item.lessonNumber}</td>
      <td>{item.lessonType}</td>
      <td>
        <div className="title">{item.pages ? `${item.title}, ${item.pages}` : item.title}</div>
      </td>
      <td>
        <div className="chips">
          {item.focusStandards.map((code) =>
            unknown.includes(code) ? (
              <span key={code} className="chip sm warn">
                <WarningIcon />
                {code}
              </span>
            ) : (
              <span key={code} className="chip sm">
                {code}
              </span>
            ),
          )}
        </div>
      </td>
      <td className="w">
        {unknown.map((code) => (
          <div key={code}>
            <span className="warn-text">
              <WarningIcon />
              {code} isn&apos;t in the standards reference data.
            </span>
            <div className="caption">
              {item.focusStandards.includes(code)
                ? 'Kept as written; check the code.'
                : 'Kept as written in another standards column; check the code.'}
            </div>
          </div>
        ))}
        {otherWarnings.map((warning) => (
          <div key={warning.message} className="warn-text">
            <WarningIcon />
            {warning.message}
          </div>
        ))}
        {wasNormalized(item) ? (
          <span className="caption">Read from &quot;{item.focusStandardsText}&quot;</span>
        ) : null}
      </td>
    </tr>
  )
}

function FlexRow({ count }: { count: number }) {
  return (
    <tr>
      <td className="n muted">–</td>
      <td className="muted">End-of-arc flex day</td>
      <td className="muted" colSpan={3}>
        {count} {plural(count, 'flex day', 'flex days')}, stored but not generated. You can generate
        a flex day later.
      </td>
    </tr>
  )
}

function EldNotice({ eld }: { eld: EldPreview }) {
  const empty = eld.rowsWithContent === 0
  const unmatched =
    eld.unmatchedRows.length > 0 ? (
      <> Rows that didn&apos;t match a lesson: {eld.unmatchedRows.join(', ')}.</>
    ) : (
      ' Every row matched a lesson.'
    )
  if (empty) {
    return (
      <div className="notice warn">
        <WarningIcon />
        <div>
          <b>ELD file attached: {eld.rows} rows, every content column is empty.</b> Nothing from it
          will be added to the generation input; ELD support comes from the outline&apos;s
          Designated ELD Standards column.{unmatched}
        </div>
      </div>
    )
  }
  return (
    <div className={`notice ${eld.unmatchedRows.length > 0 ? 'warn' : 'info'}`}>
      <WarningIcon />
      <div>
        <b>
          ELD file attached: {eld.rows} rows, {eld.rowsWithContent} with content, {eld.matched}{' '}
          matched to lessons.
        </b>{' '}
        Filled fields are added to each matched lesson&apos;s generation input.{unmatched}
      </div>
    </div>
  )
}

interface ImportPreviewProps {
  preview: ImportPreview
  busy: 'create' | 'cancel' | null
  error: string | null
  onCreate: () => void
  onCancel: () => void
}

/** R4 preview (mockup R4-import-preview.html) with the R5 ELD summary when a file is attached. */
export function ImportPreviewView({
  preview,
  busy,
  error,
  onCreate,
  onCancel,
}: ImportPreviewProps) {
  const title = useRef<HTMLHeadingElement>(null)
  const { unit } = preview
  const author = bannerAuthor(unit.banner)
  const standardsWarnings = new Set(
    preview.warnings.flatMap((warning) => (warning.code ? [warning.code] : [])),
  ).size
  const outlineWarnings = preview.warnings.filter((warning) => !warning.code)
  const lessonCount = preview.lessons.length

  // Focus lands on the page title after parsing (R4 accessibility notes).
  useEffect(() => {
    title.current?.focus()
  }, [])

  return (
    <>
      <main className="page preview" style={{ paddingBottom: 24 }}>
        <div className="crumbs">
          <Link href="/units">Units</Link> / Import
        </div>
        <h1 className="h1" ref={title} tabIndex={-1}>
          Check the outline before creating the unit
        </h1>
        <p className="sub" style={{ marginTop: 4 }}>
          Grade {unit.grade}, Unit {unit.unitNumber}: <i>{unit.anchorTextTitle}</i>
          {author ? ` by ${author}` : ''}
          {unit.isbn ? `, ISBN ${unit.isbn}` : ''}
        </p>
        <div className="sum">
          <div>
            <b>{lessonCount}</b>
            <span>{plural(lessonCount, 'lesson', 'lessons')}</span>
          </div>
          <div>
            <b>{preview.arcs.length}</b>
            <span>{plural(preview.arcs.length, 'arc', 'arcs')}</span>
          </div>
          <div>
            <b>{preview.flexDays.length}</b>
            <span>{plural(preview.flexDays.length, 'flex day', 'flex days')}, not generated</span>
          </div>
          <div>
            <b className={standardsWarnings > 0 ? 'warned' : undefined}>{standardsWarnings}</b>
            <span>{plural(standardsWarnings, 'standards warning', 'standards warnings')}</span>
          </div>
        </div>
        {outlineWarnings.length > 0 ? (
          <div className="notice warn">
            <WarningIcon />
            <div>
              <b>Some rows were skipped.</b>
              <ul>
                {outlineWarnings.map((warning) => (
                  <li key={warning.message}>{warning.message}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
        {preview.eld ? <EldNotice eld={preview.eld} /> : null}
        <div className="panel">
          <table className="table">
            <thead>
              <tr>
                <th className="n" scope="col">
                  #
                </th>
                <th scope="col">Type</th>
                <th scope="col">Title or description</th>
                <th scope="col">Focus standards</th>
                <th scope="col">Warnings</th>
              </tr>
            </thead>
            <tbody>
              {preview.arcs.map((arc) => {
                const flexCount = preview.flexDays.filter(
                  (item) => item.arcName === arc.name,
                ).length
                return (
                  <Fragment key={arc.name}>
                    <tr className="arc">
                      <td colSpan={5}>{arc.name}</td>
                    </tr>
                    {preview.lessons
                      .filter((item) => item.arcName === arc.name)
                      .map((item) => (
                        <LessonRow key={item.position} item={item} />
                      ))}
                    {flexCount > 0 ? <FlexRow count={flexCount} /> : null}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </main>
      <div className="footer-bar">
        {error ? (
          <p className="errmsg" role="alert">
            <ErrorIcon />
            <span>{error}</span>
          </p>
        ) : (
          <span className="sub">Nothing has been saved yet. Cancelling discards this import.</span>
        )}
        <span className="spacer" />
        <button className="btn" type="button" onClick={onCancel} disabled={busy !== null}>
          Cancel import
        </button>
        <button className="btn primary" type="button" onClick={onCreate} disabled={busy !== null}>
          Create unit with {lessonCount} {plural(lessonCount, 'lesson', 'lessons')}
        </button>
      </div>
    </>
  )
}
