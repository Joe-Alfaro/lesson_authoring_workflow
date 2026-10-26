import { requireApiRole } from '../../../../../auth/require_role'
import { getDb } from '../../../../../db/client'
import { ImportNotFoundError, confirmImport } from '../../../../../import/import_service'

export const dynamic = 'force-dynamic'

/** R4: turns a previewed import into a unit. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await requireApiRole(['author'])
  if (user instanceof Response) {
    return user
  }
  const { id } = await params
  try {
    const result = await confirmImport(getDb(), id, { userId: user.id })
    return Response.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ImportNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 })
    }
    throw error
  }
}
