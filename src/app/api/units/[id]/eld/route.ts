import { requireRole } from '../../../../../auth/require_role'
import { getDb } from '../../../../../db/client'
import { UnitNotFoundError, attachEldFile } from '../../../../../import/eld_service'
import { badRequest, readUploadedFile } from '../../../../../import/http'

export const dynamic = 'force-dynamic'

/** R5: attaches an ELD scope-and-sequence CSV to a unit. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  await requireRole(['author'])
  const { id } = await params
  try {
    const result = await attachEldFile(getDb(), id, await readUploadedFile(request))
    return Response.json(result)
  } catch (error) {
    if (error instanceof UnitNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 })
    }
    return badRequest(error)
  }
}
