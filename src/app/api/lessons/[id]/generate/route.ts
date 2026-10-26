import { requireApiRole } from '../../../../../auth/require_role'
import { generationDeps } from '../../../../../generation_api/boss'
import { generationErrorResponse, optionalString } from '../../../../../generation_api/http'
import { isUuid } from '../../../../../import/is_uuid'
import { generateFlexDay } from '../../../../../generation/service'
import { BadRequestError, readJsonObject } from '../../../../../workflow/http'

export const dynamic = 'force-dynamic'

/** R6: generates one flex day on request. Body `{ model? }` -> 201 `{ runId, jobCount }`. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await requireApiRole(['author'])
  if (user instanceof Response) {
    return user
  }
  const { id } = await params
  try {
    // The body is optional: an empty request uses the default model.
    const body = await readJsonObject(request).catch(() => ({}))
    if (!isUuid(id)) {
      return Response.json({ error: `Lesson ${id} not found` }, { status: 404 })
    }
    const run = await generateFlexDay(await generationDeps(), {
      lessonId: id,
      model: optionalString(body, 'model'),
      userId: user.id,
    }).catch((error: unknown) => {
      // The service rejects numbered lessons with a plain Error.
      if (error instanceof Error && error.message.startsWith('Only flex days')) {
        throw new BadRequestError(error.message)
      }
      throw error
    })
    return Response.json(run, { status: 201 })
  } catch (error) {
    return generationErrorResponse(error)
  }
}
