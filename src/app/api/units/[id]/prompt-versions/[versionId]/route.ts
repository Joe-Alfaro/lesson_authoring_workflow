import { requireRole } from '../../../../../../auth/require_role'
import { getDb } from '../../../../../../db/client'
import { generationErrorResponse } from '../../../../../../generation_api/http'
import { getPromptVersion } from '../../../../../../generation/prompt_versions'

export const dynamic = 'force-dynamic'

/** R10: one prompt version of the unit, with its template; 404 if it belongs to another unit. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; versionId: string }> },
): Promise<Response> {
  await requireRole(['author'])
  const { id, versionId } = await params
  try {
    const version = await getPromptVersion(getDb(), versionId)
    if (!version || version.unitId !== id) {
      return Response.json({ error: `Prompt version ${versionId} not found` }, { status: 404 })
    }
    return Response.json(version)
  } catch (error) {
    return generationErrorResponse(error)
  }
}
