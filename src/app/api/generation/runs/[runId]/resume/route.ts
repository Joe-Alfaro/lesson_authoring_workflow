import { requireRole } from '../../../../../../auth/require_role'
import { generationDeps } from '../../../../../../generation_api/boss'
import { generationErrorResponse } from '../../../../../../generation_api/http'
import { resumeRun } from '../../../../../../generation_api/run_cap'

export const dynamic = 'force-dynamic'

/**
 * D-024 (1): after the cap was raised, queues only the lessons the run never generated ->
 * 201 `{ runId, jobCount }` (a new run); 409 while the cap is still reached.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const user = await requireRole(['author'])
  const { runId } = await params
  try {
    const run = await resumeRun(await generationDeps(), { runId, userId: user.id })
    return Response.json(run, { status: 201 })
  } catch (error) {
    return generationErrorResponse(error)
  }
}
