// AI assist errors (R20-R22). The workflow errors (not found, forbidden, locked) live in
// src/workflow/errors.ts. Contract: src/assist/README.md.

/** A request the caller can fix (blank text, unknown action, missing instruction): 400. */
export class AssistInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AssistInputError'
  }
}

export class SectionNotFoundError extends Error {
  constructor(sectionId: string) {
    super(`Section ${sectionId} is not in this lesson.`)
    this.name = 'SectionNotFoundError'
  }
}

/** The global SPEND_CAP_USD is used up (runs plus assist calls): 402. */
export class AssistBudgetError extends Error {
  constructor(
    readonly spentUsd: number,
    readonly capUsd: number,
  ) {
    super(
      `AI budget used up: $${spentUsd.toFixed(2)} of the $${capUsd.toFixed(2)} spend cap is spent. Ask an admin to raise SPEND_CAP_USD.`,
    )
    this.name = 'AssistBudgetError'
  }
}

/** The model failed or kept answering something unusable, after one repair retry: 502. */
export class AssistOutputError extends Error {
  constructor(message = 'The AI could not produce a usable answer. Try again.') {
    super(message)
    this.name = 'AssistOutputError'
  }
}

/** No ANTHROPIC_API_KEY on the server: 503. */
export class AssistUnavailableError extends Error {
  constructor(message = 'AI assist is not configured on this server.') {
    super(message)
    this.name = 'AssistUnavailableError'
  }
}
