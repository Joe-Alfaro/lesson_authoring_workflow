import { requireRole } from '../../../../../auth/require_role'
import { getDb } from '../../../../../db/client'
import { lessonStatus, type LessonStatus } from '../../../../../db/schema'
import { getUnitDashboard, type DashboardFilters } from '../../../../../workflow/dashboard'
import { BadRequestError, workflowErrorResponse } from '../../../../../workflow/http'

export const dynamic = 'force-dynamic'

function isLessonStatus(value: string): value is LessonStatus {
  return (lessonStatus.enumValues as readonly string[]).includes(value)
}

/** `?status=a&status=b&arc=<id>&assignee=<id>|unassigned` */
function readFilters(query: URLSearchParams): DashboardFilters {
  const filters: DashboardFilters = {}
  const statuses = query.getAll('status')
  if (statuses.length > 0) {
    const unknown = statuses.find((status) => !isLessonStatus(status))
    if (unknown !== undefined) {
      throw new BadRequestError(`Unknown status filter "${unknown}".`)
    }
    filters.status = statuses as LessonStatus[]
  }
  const arc = query.get('arc')
  if (arc) {
    filters.arcId = arc
  }
  const assignee = query.get('assignee')
  if (assignee) {
    filters.assigneeId = assignee === 'unassigned' ? null : assignee
  }
  return filters
}

/** R24: the unit review dashboard. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  await requireRole(['author', 'reviewer', 'approver'])
  const { id } = await params
  try {
    const dashboard = await getUnitDashboard(
      getDb(),
      id,
      readFilters(new URL(request.url).searchParams),
    )
    if (!dashboard) {
      return Response.json({ error: `Unit ${id} does not exist.` }, { status: 404 })
    }
    return Response.json(dashboard)
  } catch (error) {
    return workflowErrorResponse(error)
  }
}
