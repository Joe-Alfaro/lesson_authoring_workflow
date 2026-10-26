import { requireApiRole } from '../../../../../auth/require_role'
import { getDb } from '../../../../../db/client'
import { unitFileName } from '../../../../../export/file_names'
import { renderUnitHtml } from '../../../../../export/html'
import { downloadResponse, exportFormat, formatError } from '../../../../../export/http'
import { buildUnitExport } from '../../../../../export/service'

export const dynamic = 'force-dynamic'

/** R16: the unit's approved lessons as JSON (default) or one HTML document, with counts. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const access = await requireApiRole(['author', 'reviewer', 'approver'])
  if (access instanceof Response) {
    return access
  }
  const format = exportFormat(request)
  if (!format) {
    return formatError()
  }
  const { id } = await params
  const data = await buildUnitExport(getDb(), id)
  if (!data) {
    return Response.json({ error: 'Unit not found' }, { status: 404 })
  }
  return downloadResponse(format, unitFileName(data.unit, format), data, () => renderUnitHtml(data))
}
