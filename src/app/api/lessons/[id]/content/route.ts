import { requireApiRole } from '../../../../../auth/require_role'
import { getDb } from '../../../../../db/client'
import {
  BadRequestError,
  readJsonObject,
  workflowErrorResponse,
} from '../../../../../workflow/http'
import { saveLessonContent } from '../../../../../workflow/versions'

export const dynamic = 'force-dynamic'

/** R14: the editor's idle save; stores the content and a version by the session user. */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await requireApiRole(['author', 'reviewer', 'approver'])
  if (user instanceof Response) {
    return user
  }
  const { id } = await params
  try {
    const body = await readJsonObject(request)
    if (body.content == null) {
      throw new BadRequestError('Send the lesson as { "content": … }.')
    }
    const result = await saveLessonContent(getDb(), {
      lessonId: id,
      userId: user.id,
      content: body.content,
    })
    return Response.json(result)
  } catch (error) {
    return workflowErrorResponse(error)
  }
}
