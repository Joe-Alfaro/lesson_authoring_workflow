import { requireRole } from '../../../../auth/require_role'
import { ImportFlow } from '../../../../ui/import/import_flow'

/** R1 import. Only authors (and admins) import outlines, matching POST /api/imports. */
export default async function ImportPage() {
  await requireRole(['author'])
  return <ImportFlow />
}
