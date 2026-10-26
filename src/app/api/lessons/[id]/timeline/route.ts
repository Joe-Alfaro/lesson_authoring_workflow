import { requireRole } from '../../../../../auth/require_role'
import { getDb } from '../../../../../db/client'
import { workflowErrorResponse } from '../../../../../workflow/http'
import { getLessonTimeline } from '../../../../../workflow/timeline'

export const dynamic = 'force-dynamic'

/** R23-history: status changes and assignments, oldest first. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  await requireRole(['author', 'reviewer', 'approver'])
  const { id } = await params
  try {
    return Response.json({ events: await getLessonTimeline(getDb(), id) })
  } catch (error) {
    return workflowErrorResponse(error)
  }
}
