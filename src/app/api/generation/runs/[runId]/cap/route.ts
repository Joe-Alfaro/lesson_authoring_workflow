import { requireRole } from '../../../../../../auth/require_role'
import { getDb } from '../../../../../../db/client'
import { generationErrorResponse } from '../../../../../../generation_api/http'
import { raiseRunCap } from '../../../../../../generation_api/run_cap'
import { BadRequestError, readJsonObject } from '../../../../../../workflow/http'

export const dynamic = 'force-dynamic'

/**
 * D-024 (1): an admin raises the cap of a run stopped by it, within the global SPEND_CAP_USD.
 * Body `{ capUsd }` -> 200 `{ capUsd }`; 400 when it is over the budget.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
): Promise<Response> {
  // Admins pass every role check; an empty list lets only them through.
  await requireRole([])
  const { runId } = await params
  try {
    const body = await readJsonObject(request)
    if (typeof body.capUsd !== 'number') {
      throw new BadRequestError('"capUsd" must be a number of dollars.')
    }
    return Response.json(await raiseRunCap(getDb(), { runId, capUsd: body.capUsd }))
  } catch (error) {
    return generationErrorResponse(error)
  }
}
