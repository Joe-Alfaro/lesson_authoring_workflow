import { requireApiRole } from '../../../../../../auth/require_role'
import { generationDeps } from '../../../../../../generation_api/boss'
import { generationErrorResponse } from '../../../../../../generation_api/http'
import { cancelRun, getRun, NotFoundError } from '../../../../../../generation/service'
import { isUuid } from '../../../../../../import/is_uuid'

export const dynamic = 'force-dynamic'

/** R11: queued lessons stop, finished ones are kept -> 200 `{ status }`. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const access = await requireApiRole(['author'])
  if (access instanceof Response) {
    return access
  }
  const { runId } = await params
  try {
    const deps = await generationDeps()
    if (!isUuid(runId) || !(await getRun(deps.db, runId))) {
      throw new NotFoundError(`Run ${runId}`)
    }
    await cancelRun(deps, runId)
    const run = await getRun(deps.db, runId)
    return Response.json({ status: run?.status })
  } catch (error) {
    return generationErrorResponse(error)
  }
}
