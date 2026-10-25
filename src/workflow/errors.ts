import type { LessonStatus } from '../db/schema'

export class LessonNotFoundError extends Error {
  constructor(lessonId: string) {
    super(`Lesson ${lessonId} does not exist.`)
    this.name = 'LessonNotFoundError'
  }
}

export class VersionNotFoundError extends Error {
  constructor(versionId: string) {
    super(`Version ${versionId} does not exist for this lesson.`)
    this.name = 'VersionNotFoundError'
  }
}

export class WorkflowForbiddenError extends Error {
  constructor(message = 'Your role cannot take this action.') {
    super(message)
    this.name = 'WorkflowForbiddenError'
  }
}

export class InvalidTransitionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidTransitionError'
  }
}

export class NoteRequiredError extends Error {
  constructor(message = 'A note is required to request changes.') {
    super(message)
    this.name = 'NoteRequiredError'
  }
}

export class LessonLockedError extends Error {
  constructor(status: LessonStatus) {
    super(
      status === 'approved'
        ? 'The lesson is approved; an approver must reopen it before it can be edited.'
        : 'The lesson is being generated and cannot be edited yet.',
    )
    this.name = 'LessonLockedError'
  }
}

export class InvalidAssigneeError extends Error {
  constructor(message = 'Lessons can be assigned only to reviewers and approvers.') {
    super(message)
    this.name = 'InvalidAssigneeError'
  }
}
