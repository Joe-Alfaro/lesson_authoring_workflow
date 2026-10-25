import { requireRole } from '../../../auth/require_role'
import { getDb } from '../../../db/client'
import {
  BadInputError,
  badRequest,
  isMultipart,
  readForm,
  readFormFile,
} from '../../../import/http'
import { previewImport, type ImportSource } from '../../../import/import_service'

export const dynamic = 'force-dynamic'

interface PreviewRequest {
  source: ImportSource
  eldCsv?: string
}

function sheetSource(url: unknown): ImportSource {
  if (typeof url !== 'string' || url.trim() === '') {
    throw new BadInputError('Send a Google Sheets link as { "url": … } or upload a CSV file.')
  }
  return { kind: 'sheet', url }
}

/**
 * JSON `{ url }`, or multipart with the outline as `file` or a `url` field, plus an optional
 * ELD scope-and-sequence file as `eld` (R5).
 */
async function readPreviewRequest(request: Request): Promise<PreviewRequest> {
  if (!isMultipart(request)) {
    const body: unknown = await request.json().catch(() => null)
    return { source: sheetSource((body as { url?: unknown } | null)?.url) }
  }
  const form = await readForm(request)
  const csv = await readFormFile(form, 'file')
  const eldCsv = await readFormFile(form, 'eld')
  return {
    source: csv === null ? sheetSource(form.get('url')) : { kind: 'csv', csv },
    ...(eldCsv === null ? {} : { eldCsv }),
  }
}

/** R1, R4, R5: parses an outline from a sheet link or an uploaded CSV and returns the preview. */
export async function POST(request: Request): Promise<Response> {
  const user = await requireRole(['author'])
  try {
    const { source, eldCsv } = await readPreviewRequest(request)
    const preview = await previewImport(getDb(), source, { userId: user.id, eldCsv })
    return Response.json(preview)
  } catch (error) {
    return badRequest(error)
  }
}
