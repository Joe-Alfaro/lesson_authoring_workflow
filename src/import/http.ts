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

/** Turns an author-fixable error into a 400 `{ error }`; anything else is rethrown. */
export function badRequest(error: unknown): Response {
  if (BAD_INPUT.some((type) => error instanceof type)) {
    return Response.json({ error: (error as Error).message }, { status: 400 })
  }
  throw error
}

/** The text of the multipart field `file`. */
export async function readUploadedFile(request: Request): Promise<string> {
  const form = await request.formData().catch(() => {
    throw new BadInputError('Upload a CSV file in the "file" field.')
  })
  const file = form.get('file')
  if (!(file instanceof File)) {
    throw new BadInputError('Upload a CSV file in the "file" field.')
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new BadInputError('The file is larger than 5 MB; upload the CSV export of one tab.')
  }
  return file.text()
}

export function isMultipart(request: Request): boolean {
  return (request.headers.get('content-type') ?? '').startsWith('multipart/form-data')
}
