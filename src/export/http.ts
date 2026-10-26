// R16 route helpers: the format query and the download response (README: Routes).
import type { ExportExtension } from './file_names'

/** `format=json` (the default) or `format=html`; null for anything else (400). */
export function exportFormat(request: Request): ExportExtension | null {
  const format = new URL(request.url).searchParams.get('format') ?? 'json'
  return format === 'json' || format === 'html' ? format : null
}

export function formatError(): Response {
  return Response.json(
    { error: 'Unknown format; use format=json or format=html.' },
    { status: 400 },
  )
}

/** The export as a file download; `fileName` is already safe (lessonFileName, unitFileName). */
export function downloadResponse(
  format: ExportExtension,
  fileName: string,
  data: unknown,
  renderHtml: () => string,
): Response {
  const body = format === 'json' ? JSON.stringify(data, null, 2) : renderHtml()
  return new Response(body, {
    headers: {
      'content-type':
        format === 'json' ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8',
      'content-disposition': `attachment; filename="${fileName}"`,
      'cache-control': 'no-store',
    },
  })
}
