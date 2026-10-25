import { requireRole } from '../../../../../../../auth/require_role'
import { getDb } from '../../../../../../../db/client'
import { workflowErrorResponse } from '../../../../../../../workflow/http'
import { restoreVersion } from '../../../../../../../workflow/versions'

export const dynamic = 'force-dynamic'

/** R14: restores an earlier version as a new version by the session user. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; versionId: string }> },
): Promise<Response> {
  const user = await requireRole(['author', 'reviewer', 'approver'])
  const { id, versionId } = await params
  try {
    const result = await restoreVersion(getDb(), { lessonId: id, versionId, userId: user.id })
    return Response.json(result, { status: 201 })
  } catch (error) {
    return workflowErrorResponse(error)
  }
}
