// R7 / R5 / R10: loading a lesson's prompt input from the database. Contract:
// src/generation/README.md. The pure prompt text is covered by prompt_builder.test.ts.
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connectTestDb } from '../../tests/db'
import { createTestUnit, questionMarker } from '../../tests/generation_fixtures'
import { runMigrations } from '../db/migrate'
import { lessonStandards, standards } from '../db/schema'
import { buildLessonPrompt } from './prompt_builder'
import { loadLessonPromptInput } from './prompt_input'
import { DEFAULT_PROMPT_TEMPLATE } from './prompt_template'
import { getCurrentPromptVersion, savePromptVersion } from './prompt_versions'

describe('loadLessonPromptInput', () => {
  const { pool, db } = connectTestDb()

  beforeAll(async () => {
    await runMigrations(pool)
  })
  afterAll(() => pool.end())

  it('loads the outline row, arc, standards with full text, and neighbours', async () => {
    // Lessons 1, 2, flex, 3: lesson 2's next lesson is 3 (flex days are skipped).
    const unit = await createTestUnit(db, { lessons: 3, flexAfter: [2] })
    const lessonId = unit.lessonIds[1]!
    await db.insert(lessonStandards).values([
      { lessonId, code: 'ELD.PI.6.6', kind: 'eld', position: 0 },
      { lessonId, code: 'RL.6.99', kind: 'supporting', position: 1 },
    ])
    const [rl] = await db.select().from(standards).where(eq(standards.code, 'RL.6.1'))

    const input = await loadLessonPromptInput(db, lessonId)

    expect(input.lesson).toEqual(
      expect.objectContaining({
        id: lessonId,
        lessonNumber: 2,
        isFlex: false,
        lessonType: 'Core Reading',
        days: 1,
        textDependentQuestion: questionMarker(2),
        description: 'Lesson 2 description.',
      }),
    )
    expect(input.unit).toEqual(
      expect.objectContaining({
        grade: 6,
        unitNumber: 4,
        anchorTextTitle: 'Placeholder Anchor Novel',
      }),
    )
    expect(input.arc).toEqual({ name: 'Investigation 1', description: 'Arc description.' })
    expect(input.standards).toEqual(
      expect.arrayContaining([
        { code: 'RL.6.1', kind: 'focus', text: rl!.text },
        { code: 'L.6.4', kind: 'supporting', text: expect.any(String) },
        { code: 'ELD.PI.6.6', kind: 'eld', text: expect.any(String) },
        { code: 'RL.6.99', kind: 'supporting', text: null },
      ]),
    )
    expect(input.previousLesson).toEqual({ lessonNumber: 1, description: 'Lesson 1 description.' })
    expect(input.nextLesson).toEqual({ lessonNumber: 3, description: 'Lesson 3 description.' })
    expect(input.eldInput).toBeNull()
  })

  it('has no previous lesson for lesson 1 and no next lesson for the last one', async () => {
    const unit = await createTestUnit(db, { lessons: 2 })

    expect((await loadLessonPromptInput(db, unit.lessonIds[0]!)).previousLesson).toBeNull()
    expect((await loadLessonPromptInput(db, unit.lessonIds[1]!)).nextLesson).toBeNull()
  })

  it('gives a flex day the numbered lessons around it as neighbours', async () => {
    const unit = await createTestUnit(db, { lessons: 3, flexAfter: [2] })

    const input = await loadLessonPromptInput(db, unit.flexIds[0]!)

    expect(input.lesson.isFlex).toBe(true)
    expect(input.lesson.lessonNumber).toBeNull()
    expect(input.previousLesson?.lessonNumber).toBe(2)
    expect(input.nextLesson?.lessonNumber).toBe(3)
  })

  it("uses the unit's current prompt version unless one is given", async () => {
    const unit = await createTestUnit(db, { lessons: 1 })
    const v1 = await getCurrentPromptVersion(db, unit.unitId)
    const v2 = await savePromptVersion(db, {
      unitId: unit.unitId,
      template: { ...DEFAULT_PROMPT_TEMPLATE, system: 'Version two system.' },
    })

    const current = await loadLessonPromptInput(db, unit.lessonIds[0]!)
    expect(current.promptVersion).toEqual(
      expect.objectContaining({
        id: v2.id,
        version: 2,
        template: expect.objectContaining({ system: 'Version two system.' }),
      }),
    )
    expect(buildLessonPrompt(current).system).toContain('Version two system.')

    const pinned = await loadLessonPromptInput(db, unit.lessonIds[0]!, { promptVersionId: v1.id })
    expect(pinned.promptVersion.id).toBe(v1.id)
  })

  it('passes the ELD input from getEldInput through (R5)', async () => {
    const unit = await createTestUnit(db, { lessons: 1 })
    const lessonId = unit.lessonIds[0]!

    const input = await loadLessonPromptInput(db, lessonId, {
      getEldInput: async (_db, id) =>
        id === lessonId ? { languageObjective: 'ELD objective.' } : null,
    })

    expect(input.eldInput).toEqual({ languageObjective: 'ELD objective.' })
    expect(buildLessonPrompt(input).prompt).toContain('ELD objective.')
  })
})
