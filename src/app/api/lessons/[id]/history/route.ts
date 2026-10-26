import { requireApiRole } from '../../../../../auth/require_role'
import { getDb } from '../../../../../db/client'
import { workflowErrorResponse } from '../../../../../workflow/http'
import { getLessonHistory } from '../../../../../workflow/service'

export const dynamic = 'force-dynamic'

/** R23: who moved the lesson, when, and the note, oldest first. */
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
    return Response.json({ events: await getLessonHistory(getDb(), id) })
  } catch (error) {
    return workflowErrorResponse(error)
  }
}
