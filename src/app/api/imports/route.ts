import { requireRole } from '../../../auth/require_role'
import { getDb } from '../../../db/client'
import { BadInputError, badRequest, isMultipart, readUploadedFile } from '../../../import/http'
import { previewImport, type ImportSource } from '../../../import/import_service'

export const dynamic = 'force-dynamic'

async function readSource(request: Request): Promise<ImportSource> {
  if (isMultipart(request)) {
    return { kind: 'csv', csv: await readUploadedFile(request) }
  }
  const body: unknown = await request.json().catch(() => null)
  const url = (body as { url?: unknown } | null)?.url
  if (typeof url !== 'string' || url.trim() === '') {
    throw new BadInputError('Send a Google Sheets link as { "url": … } or upload a CSV file.')
  }
  return { kind: 'sheet', url }
}

/** R1, R4: parses an outline from a sheet link or an uploaded CSV and returns the preview. */
export async function POST(request: Request): Promise<Response> {
  const user = await requireRole(['author'])
  try {
    const preview = await previewImport(getDb(), await readSource(request), { userId: user.id })
    return Response.json(preview)
  } catch (error) {
    return badRequest(error)
  }
}
