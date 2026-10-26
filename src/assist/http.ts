// JSON error answers of the AI assist routes. Contract: src/assist/README.md.
import { BadRequestError, workflowErrorResponse } from '../workflow/http'
import {
  AssistBudgetError,
  AssistInputError,
  AssistOutputError,
  AssistUnavailableError,
  SectionNotFoundError,
} from './errors'

const STATUS_BY_ERROR: [new (...args: never[]) => Error, number][] = [
  [SectionNotFoundError, 404],
  [AssistInputError, 400],
  [AssistBudgetError, 402],
  [AssistOutputError, 502],
  [AssistUnavailableError, 503],
]

/** Maps an assist or workflow error to its JSON `{ error }` answer; anything else is rethrown. */
export function assistErrorResponse(error: unknown): Response {
  const match = STATUS_BY_ERROR.find(([type]) => error instanceof type)
  if (match) {
    return Response.json({ error: (error as Error).message }, { status: match[1] })
  }
  return workflowErrorResponse(error)
}

export function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key]
  if (value == null) return undefined
  if (typeof value !== 'string') throw new BadRequestError(`"${key}" must be a string.`)
  return value
}

export function requiredString(body: Record<string, unknown>, key: string): string {
  const value = optionalString(body, key)
  if (value === undefined) throw new BadRequestError(`"${key}" is required.`)
  return value
}
