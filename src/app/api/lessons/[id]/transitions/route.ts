import { requireRole } from '../../../../../auth/require_role'
import { getDb } from '../../../../../db/client'
import {
  BadRequestError,
  readJsonObject,
  workflowErrorResponse,
} from '../../../../../workflow/http'
import { transitionLesson } from '../../../../../workflow/service'
import { WORKFLOW_ACTIONS, isWorkflowAction } from '../../../../../workflow/transitions'

export const dynamic = 'force-dynamic'

/** R23: a review action. Which role may take it is the service's decision (403 otherwise). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await requireRole(['author', 'reviewer', 'approver'])
  const { id } = await params
  try {
    const body = await readJsonObject(request)
    if (!isWorkflowAction(body.action)) {
      throw new BadRequestError(`"action" must be one of: ${WORKFLOW_ACTIONS.join(', ')}.`)
    }
    if (body.note != null && typeof body.note !== 'string') {
      throw new BadRequestError('"note" must be a string.')
    }
    const { status } = await transitionLesson(getDb(), {
      lessonId: id,
      action: body.action,
      actor: { id: user.id, role: user.role },
      note: body.note,
    })
    return Response.json({ status })
  } catch (error) {
    return workflowErrorResponse(error)
  }
}
