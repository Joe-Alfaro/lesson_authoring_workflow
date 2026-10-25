import { requireRole } from '../../../../auth/require_role'
import { getDb } from '../../../../db/client'
import { cancelImport } from '../../../../import/import_service'

export const dynamic = 'force-dynamic'

/** R4: cancels a previewed import. Idempotent: an unknown id also answers 204. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  await requireRole(['author'])
  const { id } = await params
  await cancelImport(getDb(), id)
  return new Response(null, { status: 204 })
}
