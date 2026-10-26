import { requireApiRole } from '../../../../../../auth/require_role'
import { getDb } from '../../../../../../db/client'
import { getVersion } from '../../../../../../workflow/versions'

export const dynamic = 'force-dynamic'

/** R14: one earlier version with its content. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; versionId: string }> },
): Promise<Response> {
  const access = await requireApiRole(['author', 'reviewer', 'approver'])
  if (access instanceof Response) {
    return access
  }
  const { id, versionId } = await params
  const version = await getVersion(getDb(), { lessonId: id, versionId })
  if (!version) {
    return Response.json({ error: 'This version does not exist for the lesson.' }, { status: 404 })
  }
  return Response.json(version)
}
