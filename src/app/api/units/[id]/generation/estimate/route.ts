import { requireApiRole } from '../../../../../../auth/require_role'
import { getDb } from '../../../../../../db/client'
import { readOnlyDeps } from '../../../../../../generation_api/boss'
import { generationErrorResponse } from '../../../../../../generation_api/http'
import { assertUnitExists } from '../../../../../../generation_api/units'
import { estimateRunCost } from '../../../../../../generation/service'

export const dynamic = 'force-dynamic'

/**
 * R12: the estimate shown before starting, `?model=<id>` (default: GENERATION_MODEL) ->
 * 200 `{ lessonCount, estimatedUsd, perLessonUsd }`.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const access = await requireApiRole(['author'])
  if (access instanceof Response) {
    return access
  }
  const { id } = await params
  try {
    const db = getDb()
    await assertUnitExists(db, id)
    const model = new URL(request.url).searchParams.get('model') ?? undefined
    const { lessonCount, estimatedUsd } = await estimateRunCost(readOnlyDeps(db), {
      unitId: id,
      model,
    })
    return Response.json({
      lessonCount,
      estimatedUsd,
      perLessonUsd: lessonCount > 0 ? estimatedUsd / lessonCount : 0,
    })
  } catch (error) {
    return generationErrorResponse(error)
  }
}
