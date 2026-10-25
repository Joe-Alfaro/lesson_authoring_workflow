import { EldParseError } from './parse_eld'
import { OutlineParseError } from './parse_outline'
import { SheetAccessError, SheetLinkError } from './sheet_link'

// The sample outline is about 100 KB; anything far larger is not an outline.
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

/** Input the author can fix: answered with 400 and the message. */
export class BadInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BadInputError'
  }
}

const BAD_INPUT = [
  BadInputError,
  OutlineParseError,
  EldParseError,
  SheetLinkError,
  SheetAccessError,
]

/**
 * Turns an author-fixable error into a 400 `{ error, reason }`; anything else is rethrown.
 * `reason` lets the UI tell which field the error belongs to.
 */
export function badRequest(error: unknown): Response {
  if (BAD_INPUT.some((type) => error instanceof type)) {
    return Response.json(
      { error: (error as Error).message, reason: reasonOf(error as Error) },
      { status: 400 },
    )
  }
  throw error
}

export type BadInputReason = 'sheet_not_shared' | 'sheet_link' | 'eld_file' | 'input'

function reasonOf(error: Error): BadInputReason {
  if (error instanceof SheetAccessError) {
    return 'sheet_not_shared'
  }
  if (error instanceof SheetLinkError) {
    return 'sheet_link'
  }
  if (error instanceof EldParseError) {
    return 'eld_file'
  }
  return 'input'
}

export async function readForm(request: Request): Promise<FormData> {
  return request.formData().catch(() => {
    throw new BadInputError('Upload a CSV file in the "file" field.')
  })
}

/** The text of a multipart file field, or null when the field is absent or empty. */
export async function readFormFile(form: FormData, field: string): Promise<string | null> {
  const file = form.get(field)
  if (!(file instanceof File) || (file.size === 0 && file.name === '')) {
    return null
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new BadInputError('The file is larger than 5 MB; upload the CSV export of one tab.')
  }
  return file.text()
}

/** The text of the multipart field `file`. */
export async function readUploadedFile(request: Request): Promise<string> {
  const csv = await readFormFile(await readForm(request), 'file')
  if (csv === null) {
    throw new BadInputError('Upload a CSV file in the "file" field.')
  }
  return csv
}

export function isMultipart(request: Request): boolean {
  return (request.headers.get('content-type') ?? '').startsWith('multipart/form-data')
}
