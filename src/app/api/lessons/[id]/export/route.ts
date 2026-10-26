import { requireApiRole } from '../../../../../auth/require_role'
import { getDb } from '../../../../../db/client'
import { lessonFileName } from '../../../../../export/file_names'
import { renderLessonHtml } from '../../../../../export/html'
import { downloadResponse, exportFormat, formatError } from '../../../../../export/http'
import { buildLessonExport } from '../../../../../export/service'

export const dynamic = 'force-dynamic'

/** R16: one lesson as JSON (default) or standalone HTML; a lesson not yet approved is marked. */
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
  const result = await buildLessonExport(getDb(), id)
  if (!result.ok) {
    return result.reason === 'not_found'
      ? Response.json({ error: 'Lesson not found' }, { status: 404 })
      : Response.json({ error: 'This lesson has no valid content to export yet.' }, { status: 409 })
  }
  const { unit, lesson } = result.data
  const fileName = lessonFileName(
    {
      unitNumber: unit.unitNumber,
      lessonNumber: lesson.number,
      position: lesson.position,
      title: lesson.content.body.title,
    },
    format,
  )
  return downloadResponse(format, fileName, result.data, () => renderLessonHtml(result.data))
}
