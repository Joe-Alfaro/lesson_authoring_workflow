// JSON `{ error }` answers for the generation and prompt routes (same shape as src/workflow/http.ts).
import { ZodError } from 'zod'
import { UnknownModelError } from '../generation/llm'
import { GlobalSpendCapError, HumanEditsError, NotFoundError } from '../generation/service'
import { BadRequestError } from '../workflow/http'
import { RunStateError, InvalidSpendCapError } from './run_cap'

const STATUS_BY_ERROR: [new (...args: never[]) => Error, number][] = [
  [NotFoundError, 404],
  [BadRequestError, 400],
  [UnknownModelError, 400],
  [InvalidSpendCapError, 400],
  [GlobalSpendCapError, 409],
  [RunStateError, 409],
]

/** Maps a generation error to its JSON answer; anything else is rethrown. */
export function generationErrorResponse(error: unknown): Response {
  if (error instanceof HumanEditsError) {
    // The caller asks for confirmation and sends the request again with confirmOverwrite.
    return Response.json(
      { error: error.message, reason: 'human_edits', lessonIds: error.lessonIds },
      { status: 409 },
    )
  }
  if (error instanceof ZodError) {
    return Response.json(
      { error: error.issues.map((issue) => issue.message).join('; ') },
      { status: 400 },
    )
  }
  const match = STATUS_BY_ERROR.find(([type]) => error instanceof type)
  if (match) {
    return Response.json({ error: (error as Error).message }, { status: match[1] })
  }
  throw error
}

export function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key]
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BadRequestError(`"${key}" must be a non-empty string.`)
  }
  return value
}

export function optionalIdList(body: Record<string, unknown>, key: string): string[] | undefined {
  const value = body[key]
  if (value === undefined) {
    return undefined
  }
  if (!Array.isArray(value) || !value.every((id) => typeof id === 'string')) {
    throw new BadRequestError(`"${key}" must be an array of ids.`)
  }
  return value as string[]
}
