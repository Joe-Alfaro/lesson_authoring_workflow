import { requireApiRole } from '../../../../../auth/require_role'
import { getDb } from '../../../../../db/client'
import { workflowErrorResponse } from '../../../../../workflow/http'
import { listVersions } from '../../../../../workflow/versions'

export const dynamic = 'force-dynamic'

/** R14: the lesson's versions, newest first, without content. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const access = await requireApiRole(['author', 'reviewer', 'approver'])
  if (access instanceof Response) {
    return access
  }
  const { id } = await params
  try {
    return Response.json({ versions: await listVersions(getDb(), id) })
  } catch (error) {
    return workflowErrorResponse(error)
  }
}
