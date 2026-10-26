import { notFound } from 'next/navigation'
import { requireRole } from '../../../../../auth/require_role'
import { getDb } from '../../../../../db/client'
import {
  getCurrentPromptVersion,
  listPromptVersions,
} from '../../../../../generation/prompt_versions'
import { PromptEditor } from '../../../../../ui/prompt/prompt_editor'
import { lessonsByPromptVersion, userNames } from '../../../../../units/prompt_usage'
import { getUnitOverview } from '../../../../../units/queries'

export const dynamic = 'force-dynamic'

/** R10: the unit's prompt template and its versions; `?version=N` shows an earlier one. */
export default async function PromptPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ version?: string }>
}) {
  await requireRole(['author'])
  const { id } = await params
  const { version } = await searchParams
  const db = getDb()
  const unit = await getUnitOverview(db, id)
  if (!unit) {
    notFound()
  }
  const current = await getCurrentPromptVersion(db, id)
  const [versions, usage] = await Promise.all([
    listPromptVersions(db, id),
    lessonsByPromptVersion(db, id),
  ])
  const names = await userNames(
    db,
    versions.flatMap((item) => (item.createdBy ? [item.createdBy] : [])),
  )
  const viewing = versions.find((item) => String(item.version) === version) ?? current

  return (
    <PromptEditor
      unit={{
        id,
        unitNumber: unit.unitNumber,
        heading: `Unit ${unit.unitNumber}: ${unit.anchorTextTitle}`,
      }}
      currentVersion={current.version}
      viewingVersion={viewing.version}
      versions={versions
        .map((item) => ({
          id: item.id,
          version: item.version,
          template: item.template,
          savedBy: item.createdBy ? (names.get(item.createdBy) ?? null) : null,
          savedAt: item.createdAt.toISOString(),
          lessonNumbers: (usage.get(item.id) ?? []).flatMap((n) => (n === null ? [] : [n])),
          lessonCount: (usage.get(item.id) ?? []).length,
        }))
        .reverse()}
      now={new Date().toISOString()}
    />
  )
}
