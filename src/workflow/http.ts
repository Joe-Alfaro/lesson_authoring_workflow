import {
  InvalidAssigneeError,
  InvalidTransitionError,
  LessonLockedError,
  LessonNotFoundError,
  NoteRequiredError,
  VersionNotFoundError,
  WorkflowForbiddenError,
} from './errors'

/** A request body or query the caller can fix: answered with 400. */
export class BadRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BadRequestError'
  }
}

const STATUS_BY_ERROR: [new (...args: never[]) => Error, number][] = [
  [LessonNotFoundError, 404],
  [VersionNotFoundError, 404],
  [WorkflowForbiddenError, 403],
  [InvalidTransitionError, 409],
  [LessonLockedError, 409],
  [NoteRequiredError, 400],
  [InvalidAssigneeError, 400],
  [BadRequestError, 400],
]

/** Maps a workflow error to its JSON `{ error }` answer; anything else is rethrown. */
export function workflowErrorResponse(error: unknown): Response {
  const match = STATUS_BY_ERROR.find(([type]) => error instanceof type)
  if (match) {
    return Response.json({ error: (error as Error).message }, { status: match[1] })
  }
  throw error
}

/** The JSON body as an object, or a BadRequestError. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const body: unknown = await request.json().catch(() => null)
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestError('Send a JSON object body.')
  }
  return body as Record<string, unknown>
}
