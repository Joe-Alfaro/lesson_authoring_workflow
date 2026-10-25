// The adapter's repair of stringified tool input (no network calls).
import { describe, expect, it } from 'vitest'
import { coreLessonBody } from '../../tests/fixtures/lesson/lesson_fixture'
import { LessonBody, lessonBodyJsonSchema } from '../lesson/schema'
import { parseStringifiedFields } from './anthropic_client'

describe('parseStringifiedFields', () => {
  it('parses a nested array the model sent as a JSON string', () => {
    const body = coreLessonBody()
    const sent = { ...body, sections: JSON.stringify(body.sections) }

    const repaired = parseStringifiedFields(sent, lessonBodyJsonSchema())

    expect(LessonBody.safeParse(repaired).success).toBe(true)
  })

  it('leaves text fields and unparseable strings alone', () => {
    const body = { ...coreLessonBody(), title: '[not json', materials: 'not json either' }

    expect(parseStringifiedFields(body, lessonBodyJsonSchema())).toEqual(body)
  })
})
