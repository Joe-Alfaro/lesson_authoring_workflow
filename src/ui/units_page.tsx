import Link from 'next/link'
import { requireRole } from '../auth/require_role'
import { ROLES, hasRole } from '../auth/roles'
import { getDb } from '../db/client'
import { listUnits } from '../units/queries'
import { UploadIcon } from './icons'
import { PacingRibbon } from './ribbon'

function ImportLink() {
  return (
    <Link className="btn primary" href="/units/import">
      <UploadIcon />
      Import an outline
    </Link>
  )
}

/** R1 Units. Mockup for the empty state: docs/design/lesson-authoring/R1-units-empty.html. */
export async function UnitsPage() {
  const user = await requireRole(ROLES)
  // Importing is an author action (POST /api/imports); other roles don't get the button.
  const canImport = hasRole(user.role, ['author'])
  const units = await listUnits(getDb())

  if (units.length === 0) {
    return (
      <main className="page">
        <h1 className="h1">Units</h1>
        <section className="panel empty" aria-labelledby="no-units">
          <div>
            <h2 className="h2" id="no-units">
              No units yet
            </h2>
            {canImport ? (
              <>
                <p className="sub lede">
                  Import a unit outline to start. Each numbered row becomes a lesson you can
                  generate, edit and send for review.
                </p>
                <div className="row" style={{ marginTop: 24 }}>
                  <ImportLink />
                </div>
              </>
            ) : (
              <p className="sub lede">
                Units appear here once an author imports an outline. Lessons assigned to you show
                under My lessons.
              </p>
            )}
          </div>
          <div aria-hidden="true">
            <div className="caption" style={{ marginBottom: 6 }}>
              One lesson, 50 minutes
            </div>
            <PacingRibbon />
            <div className="ribbon-labels">
              <span style={{ flex: 5 }} />
              <span style={{ flex: 10 }}>Lab</span>
              <span style={{ flex: 30 }}>Learning in Action</span>
              <span style={{ flex: 5 }} />
            </div>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="page">
      <div className="page-head">
        <h1 className="h1">Units</h1>
        <span className="spacer" />
        {canImport ? <ImportLink /> : null}
      </div>
      <div className="panel" style={{ marginTop: 24, overflow: 'hidden' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Unit</th>
              <th className="n">Grade</th>
              <th className="n">Lessons</th>
              <th>Imported</th>
            </tr>
          </thead>
          <tbody>
            {units.map((unit) => (
              <tr key={unit.id}>
                <td>
                  <Link className="title" href={`/units/${unit.id}`}>
                    Unit {unit.unitNumber}: {unit.anchorTextTitle}
                  </Link>
                </td>
                <td className="n">{unit.grade}</td>
                <td className="n">{unit.lessons}</td>
                <td>{unit.createdAt.toLocaleDateString('en-US', { dateStyle: 'medium' })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  )
}
