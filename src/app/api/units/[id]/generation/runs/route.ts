import { requireApiRole } from '../../../../../../auth/require_role'
import { generationDeps } from '../../../../../../generation_api/boss'
import {
  generationErrorResponse,
  optionalIdList,
  optionalString,
} from '../../../../../../generation_api/http'
import { assertUnitExists } from '../../../../../../generation_api/units'
import { regenerateLessons, startRun } from '../../../../../../generation/service'
import { BadRequestError, readJsonObject } from '../../../../../../workflow/http'

export const dynamic = 'force-dynamic'

/**
 * R6, R12: starts a run. Without `lessonIds` it queues every numbered lesson; with them, only
 * those lessons (the start dialog's "Selected lessons" or the ones not generated yet).
 * Body `{ model?, lessonIds?, confirmOverwrite? }` -> 201 `{ runId, jobCount }`.
 */
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
    const body = await readJsonObject(request)
    const deps = await generationDeps()
    await assertUnitExists(deps.db, id)
    const model = optionalString(body, 'model')
    const lessonIds = optionalIdList(body, 'lessonIds')
    if (lessonIds?.length === 0) {
      // An empty run would become the unit's latest run and hide the one before it.
      throw new BadRequestError('"lessonIds" must list at least one lesson.')
    }
    if (lessonIds) {
      const run = await regenerateLessons(deps, {
        unitId: id,
        lessonIds,
        model,
        userId: user.id,
        confirmOverwrite: body.confirmOverwrite === true,
      })
      return Response.json(run, { status: 201 })
    }
    const { runId, jobCount } = await startRun(deps, { unitId: id, model, userId: user.id })
    return Response.json({ runId, jobCount }, { status: 201 })
  } catch (error) {
    return generationErrorResponse(error)
  }
}
