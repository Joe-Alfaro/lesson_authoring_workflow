import { requireApiRole } from '../../../auth/require_role'
import { getDb } from '../../../db/client'
import { listAssignableReviewers } from '../../../workflow/assignment'

export const dynamic = 'force-dynamic'

/** R25: the assignee picker. Typed as a route handler without an unused request parameter. */
export const GET: (request: Request) => Promise<Response> = async () => {
  const access = await requireApiRole(['author', 'approver'])
  if (access instanceof Response) {
    return access
  }
  return Response.json({ reviewers: await listAssignableReviewers(getDb()) })
}
