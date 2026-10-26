import Link from 'next/link'
import { requireRole } from '../../../auth/require_role'
import { getDb } from '../../../db/client'
import { listUnits } from '../../../units/queries'

export const dynamic = 'force-dynamic'

/** R10: every unit has its own prompt; this lists them. */
export default async function PromptsPage() {
  await requireRole(['author'])
  const units = await listUnits(getDb())
  return (
    <main className="page">
      <h1 className="h1">Prompts</h1>
      <p className="sub">
        Each unit has its own prompt. Open one to edit it or see earlier versions.
      </p>
      {units.length === 0 ? (
        <p className="notice info prompts-empty">
          No units yet. <Link href="/units/import">Import an outline</Link> to get a prompt to edit.
        </p>
      ) : (
        <div className="panel prompts-list">
          <table className="table">
            <thead>
              <tr>
                <th>Unit</th>
                <th className="n">Lessons</th>
              </tr>
            </thead>
            <tbody>
              {units.map((unit) => (
                <tr key={unit.id}>
                  <td>
                    <Link className="title" href={`/units/${unit.id}/prompt`}>
                      Prompt for Unit {unit.unitNumber}: {unit.anchorTextTitle}
                    </Link>
                  </td>
                  <td className="n">{unit.lessons}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
