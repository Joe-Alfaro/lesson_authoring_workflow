import { requireRole } from '../../../../auth/require_role'
import { getDb } from '../../../../db/client'
import { assignLessons } from '../../../../workflow/assignment'
import { BadRequestError, readJsonObject, workflowErrorResponse } from '../../../../workflow/http'

export const dynamic = 'force-dynamic'

/** R25: assigns one or many lessons to a reviewer or approver; a null assignee unassigns. */
export async function POST(request: Request): Promise<Response> {
  await requireRole(['author', 'approver'])
  try {
    const body = await readJsonObject(request)
    const { lessonIds, assigneeId } = body
    if (!Array.isArray(lessonIds) || !lessonIds.every((id) => typeof id === 'string')) {
      throw new BadRequestError('"lessonIds" must be an array of lesson ids.')
    }
    if (assigneeId !== null && typeof assigneeId !== 'string') {
      throw new BadRequestError('"assigneeId" must be a user id or null.')
    }
    return Response.json(await assignLessons(getDb(), { lessonIds, assigneeId }))
  } catch (error) {
    return workflowErrorResponse(error)
  }
}
