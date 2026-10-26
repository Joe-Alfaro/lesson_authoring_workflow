// Fake LlmClient for the e2e app. The e2e server never talks to a real model provider: its
// generation worker uses this client, which answers from the prompt the real worker builds.
import {
  ESTIMATED_TOKENS_PER_LESSON,
  type LlmClient,
  type LlmRequest,
} from '../../src/generation/llm'
import type { LessonBody } from '../../src/lesson/schema'
import { coreLessonBody } from '../fixtures/lesson/lesson_fixture'

/**
 * Put this in a lesson's Text Dependent Question (directly in the database) and every call for
 * that lesson fails with FAKE_LLM_ERROR. Previous/next lessons contribute only their descriptions
 * to a prompt, so the marker hits one lesson only.
 */
export const FAIL_MARKER = 'E2E-FAIL'

export const FAKE_LLM_ERROR = 'E2E fake model error'

/** Every fake call reports the token counts the cost estimate assumes, so costs are real values. */
export const FAKE_USAGE = ESTIMATED_TOKENS_PER_LESSON

/** The title a generated lesson gets (D-024 (7): the dashboard shows it once the lesson exists). */
export function generatedTitle(lessonNumber: number | null): string {
  return lessonNumber === null ? 'Generated flex day' : `Generated title for lesson ${lessonNumber}`
}

function focusCodes(prompt: string): string[] {
  const section = /Focus standards[^\n]*:\n((?:- [^\n]*\n?)*)/.exec(prompt)
  if (!section) {
    return []
  }
  return section[1]!
    .split('\n')
    .map((line) => /^- ([^:\s]+)/.exec(line)?.[1])
    .filter((code): code is string => Boolean(code))
}

function durationMinutes(prompt: string): number {
  const match = /total duration (\d+) minutes/.exec(prompt)
  return match ? Number(match[1]) : 50
}

function lessonNumber(prompt: string): number | null {
  const match = /^- Lesson: (\d+)$/m.exec(prompt)
  return match ? Number(match[1]) : null
}

/** A schema-valid body for the lesson the prompt is about: its focus codes, its minutes. */
export function fakeLessonBody(request: LlmRequest): LessonBody {
  const text = `${request.system}\n${request.prompt}`
  const body = coreLessonBody()
  const focus = focusCodes(text)
  const minutes = durationMinutes(text)
  body.title = generatedTitle(lessonNumber(text))
  body.sections.forEach((section) => {
    if (section.kind === 'learning_in_action') {
      // Launch 5 + Literacy Lab 10 + Look Back 5; Learning in Action takes the rest.
      section.minutes = minutes - 20
      section.parts.forEach((part, index) => {
        part.standards = focus
        if ('minutes' in part && typeof part.minutes === 'number') {
          part.minutes =
            index === 0 ? Math.ceil((minutes - 20) / 2) : Math.floor((minutes - 20) / 2)
        }
      })
    } else {
      section.parts.forEach((part) => {
        part.standards = []
      })
    }
  })
  return body
}

export function createE2eFakeLlm(options: { delayMs: number }): LlmClient {
  return {
    async generateStructured(request) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs))
      if (request.prompt.includes(FAIL_MARKER)) {
        throw new Error(FAKE_LLM_ERROR)
      }
      return { output: fakeLessonBody(request), usage: FAKE_USAGE, model: request.model }
    },
  }
}
