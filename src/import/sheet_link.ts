/** The link is not a Google Sheets link. */
export class SheetLinkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SheetLinkError'
  }
}

/** The sheet could not be read without credentials: private, missing or unreachable. */
export class SheetAccessError extends Error {
  constructor(detail: string) {
    super(
      `${detail} The sheet must be shared so that anyone with the link can view it ` +
        '(Share > General access > "Anyone with the link").',
    )
    this.name = 'SheetAccessError'
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

const SHEET_PATH = /^\/spreadsheets\/d\/([A-Za-z0-9_-]+)(?:\/|$)/

/**
 * Turns a Google Sheets link (share, edit, view or export) into its CSV export URL, keeping the
 * tab (`gid`) when the link names one (R1).
 */
export function toCsvExportUrl(link: string): string {
  const url = URL.parse(link.trim())
  const id = url?.pathname.match(SHEET_PATH)?.[1]
  if (
    !url ||
    !['https:', 'http:'].includes(url.protocol) ||
    url.hostname !== 'docs.google.com' ||
    !id
  ) {
    throw new SheetLinkError(
      'Enter a Google Sheets link (https://docs.google.com/spreadsheets/d/…) or upload a CSV file.',
    )
  }
  const gid =
    new URLSearchParams(url.hash.slice(1)).get('gid') ?? url.searchParams.get('gid') ?? null
  const exportUrl = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv`
  return gid && /^\d+$/.test(gid) ? `${exportUrl}&gid=${gid}` : exportUrl
}

function looksLikeHtml(contentType: string, body: string): boolean {
  if (contentType.includes('text/html')) {
    return true
  }
  return /^\s*<(?:!doctype\s+html|html)\b/i.test(body)
}

/**
 * Downloads a sheet as CSV without Google credentials. A private sheet redirects to Google's
 * sign-in page, which fetch follows to an HTML 200, so HTML bodies count as "not shared".
 */
export async function fetchSheetCsv(link: string, fetchImpl: FetchLike = fetch): Promise<string> {
  const url = toCsvExportUrl(link)
  const response = await fetchImpl(url, { redirect: 'follow' }).catch(() => {
    throw new SheetAccessError('Google Sheets could not be reached.')
  })
  if (!response.ok) {
    throw new SheetAccessError(`Google Sheets answered ${response.status} for this link.`)
  }
  const body = await response.text()
  if (looksLikeHtml(response.headers.get('content-type') ?? '', body)) {
    throw new SheetAccessError('The sheet is private or does not exist.')
  }
  return body
}
