import { requireRole } from '../../../../../../auth/require_role'
import { generationDeps } from '../../../../../../generation_api/boss'
import {
  generationErrorResponse,
  optionalIdList,
  optionalString,
} from '../../../../../../generation_api/http'
import { assertUnitExists } from '../../../../../../generation_api/units'
import { regenerateLessons } from '../../../../../../generation/service'
import { BadRequestError, readJsonObject } from '../../../../../../workflow/http'

export const dynamic = 'force-dynamic'

/**
 * R11: regenerates `lessonIds`, or with `failed: true` every lesson whose latest job failed,
 * with the current prompt version. Lessons with human edits answer 409
 * `{ reason: 'human_edits', lessonIds }` until the request is sent with `confirmOverwrite: true`.
 * -> 201 `{ runId, jobCount }`.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await requireRole(['author'])
  const { id } = await params
  try {
    const body = await readJsonObject(request)
    const lessonIds = optionalIdList(body, 'lessonIds')
    const failed = body.failed === true
    if (!failed && (!lessonIds || lessonIds.length === 0)) {
      throw new BadRequestError('Send "lessonIds" or "failed": true.')
    }
    const deps = await generationDeps()
    await assertUnitExists(deps.db, id)
    const run = await regenerateLessons(deps, {
      unitId: id,
      ...(failed ? { failed: true as const } : { lessonIds }),
      model: optionalString(body, 'model'),
      userId: user.id,
      confirmOverwrite: body.confirmOverwrite === true,
    })
    return Response.json(run, { status: 201 })
  } catch (error) {
    return generationErrorResponse(error)
  }
}
