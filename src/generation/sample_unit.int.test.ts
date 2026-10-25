// M2 follow-up on the real sample outline (imported with M1's importer): flex days without focus
// standards (R6), front matter texts (R7, Lesson structure item 1) and a code listed as both focus
// and additional (R7). Contract: src/generation/README.md. No test calls a real model.
import { and, eq, isNull } from 'drizzle-orm'
import { PgBoss } from 'pg-boss'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest'
import { connectTestDb } from '../../tests/db'
import { createFakeLlm, TEST_MODEL, TEST_PRICES } from '../../tests/fake_llm'
import { flexLessonBody } from '../../tests/fixtures/lesson/lesson_fixture'
import { sampleOutlineCsv, STANDARDS_DIR } from '../../tests/import_fixtures'
import { runMigrations } from '../db/migrate'
import { lessons } from '../db/schema'
import { loadStandards } from '../db/seed/standards'
import { confirmImport, previewImport } from '../import/import_service'
import { LessonContent, type LessonBody } from '../lesson/schema'
import { buildLessonPrompt } from './prompt_builder'
import { loadLessonPromptInput } from './prompt_input'
import { ensureGenerationQueue, GENERATE_LESSON_QUEUE } from './queue'
import { generateFlexDay, getRun, type GenerationDeps } from './service'
import { frontMatterFromOutline, registerGenerationWorker, type GenerationWorker } from './worker'

const POLL = { timeout: 20_000, interval: 100 }

/** What a model would return for a flex row without standards: huddles carry no standard tags. */
function untaggedFlexBody(): LessonBody {
  const body = flexLessonBody()
  body.sections.forEach((section) =>
    section.parts.forEach((part) => {
      part.standards = []
      part.blocks.forEach((block) => {
        if ('standards' in block && Array.isArray(block.standards)) {
          block.standards = []
        }
      })
    }),
  )
  return body
}

describe('generation on the sample unit (R6, R7)', () => {
  const { pool, db } = connectTestDb()
  let boss: PgBoss
  let deps: GenerationDeps
  let unitId: string
  const workers: GenerationWorker[] = []

  async function numbered(lessonNumber: number) {
    const [row] = await db
      .select()
      .from(lessons)
      .where(and(eq(lessons.unitId, unitId), eq(lessons.lessonNumber, lessonNumber)))
    return row!
  }

  async function flexDays() {
    return db
      .select()
      .from(lessons)
      .where(
        and(eq(lessons.unitId, unitId), eq(lessons.isFlex, true), isNull(lessons.lessonNumber)),
      )
      .orderBy(lessons.position)
  }

  async function lessonRow(id: string) {
    const [row] = await db.select().from(lessons).where(eq(lessons.id, id))
    return row!
  }

  async function frontMatterFor(lessonNumber: number) {
    const lesson = await numbered(lessonNumber)
    const input = await loadLessonPromptInput(db, lesson.id)
    return frontMatterFromOutline(input, `Lesson ${lessonNumber}`)
  }

  beforeAll(async () => {
    await runMigrations(pool)
    await loadStandards(db, STANDARDS_DIR)
    const preview = await previewImport(db, { kind: 'csv', csv: sampleOutlineCsv() })
    unitId = (await confirmImport(db, preview.importId)).unitId
    boss = new PgBoss({ connectionString: inject('databaseUrl') })
    boss.on('error', (error) => console.error('[test] pg-boss error', error))
    await boss.start()
    deps = { db, boss, prices: TEST_PRICES }
  })
  beforeEach(async () => {
    await ensureGenerationQueue(boss)
    await boss.deleteAllJobs(GENERATE_LESSON_QUEUE)
  })
  afterEach(async () => {
    await Promise.all(workers.splice(0).map((worker) => worker.stop()))
  })
  afterAll(async () => {
    await boss.stop({ graceful: false })
    await pool.end()
  })

  describe('flex days with no focus standards (R6)', () => {
    it('the sample flex rows really have no focus standards', async () => {
      const flex = await flexDays()
      expect(flex).toHaveLength(6)
      const inputs = await Promise.all(flex.map((row) => loadLessonPromptInput(db, row.id)))
      inputs.forEach((input) =>
        expect(input.standards.filter((standard) => standard.kind === 'focus')).toEqual([]),
      )
    })

    it('generates a sample flex day on request, valid on the first attempt, with no focus standards', async () => {
      const [flex] = await flexDays()
      const llm = createFakeLlm({ respond: () => untaggedFlexBody() })
      workers.push(
        await registerGenerationWorker({
          db,
          boss,
          llm,
          prices: TEST_PRICES,
          concurrency: 1,
          maxAttempts: 2,
          pollingIntervalSeconds: 0.5,
        }),
      )

      const { runId } = await generateFlexDay(deps, {
        lessonId: flex!.id,
        model: TEST_MODEL,
        capUsd: 1,
      })
      await expect.poll(async () => (await getRun(db, runId))?.status, POLL).toBe('completed')

      const run = (await getRun(db, runId))!
      expect(run.jobs).toEqual([
        expect.objectContaining({
          lessonId: flex!.id,
          status: 'generated',
          attempts: 1,
          error: null,
        }),
      ])
      expect(llm.calls).toHaveLength(1)
      const row = await lessonRow(flex!.id)
      expect(row.status).toBe('draft')
      const content = LessonContent.parse(row.content)
      expect(content.frontMatter).toEqual(
        expect.objectContaining({ number: null, type: 'flex', focusStandards: [] }),
      )
    })
  })

  describe('a code listed as both focus and additional (R7)', () => {
    // Lesson 6: focus "RL.6.1"; additional "RL.6.1, RL.6.2, ..."
    it('is a focus standard only in the prompt input', async () => {
      const input = await loadLessonPromptInput(db, (await numbered(6)).id)
      expect(input.standards.filter((standard) => standard.code === 'RL.6.1')).toEqual([
        expect.objectContaining({ kind: 'focus' }),
      ])
      expect(input.standards).toContainEqual(
        expect.objectContaining({ code: 'RL.6.2', kind: 'supporting' }),
      )
    })

    it('is in focusStandards but not supportingStandards', async () => {
      const frontMatter = await frontMatterFor(6)
      expect(frontMatter.focusStandards).toEqual(['RL.6.1'])
      expect(frontMatter.supportingStandards).not.toContain('RL.6.1')
      expect(frontMatter.supportingStandards).toContain('RL.6.2')
    })

    it('appears once in the prompt', async () => {
      const prompt = buildLessonPrompt(await loadLessonPromptInput(db, (await numbered(6)).id))
      const text = `${prompt.system}\n${prompt.prompt}`
      expect(text.match(/^- RL\.6\.1\b(?!\.)/gm)).toHaveLength(1)
    })
  })

  describe('front matter texts: title, source and pages (R7, Lesson structure item 1)', () => {
    it('gives the anchor novel its author and the page range from the description', async () => {
      // Lesson 6 description: "Chapter 2\nFocus: pp. 16–22 ..."; banner "... by <author>".
      const { texts } = await frontMatterFor(6)
      expect(texts).toContainEqual({
        title: 'The Lightning Thief',
        source: 'Rick Riordan',
        kind: 'novel',
        pages: 'pp. 16–22',
      })
    })

    it('takes the page range of each lesson from its own description', async () => {
      // Lesson 5 description: "... Focus: pp. 9–15 ...".
      const { texts } = await frontMatterFor(5)
      expect(texts).toContainEqual(
        expect.objectContaining({ title: 'The Lightning Thief', kind: 'novel', pages: 'pp. 9–15' }),
      )
    })

    it('splits a Text Set Choice into its titled texts with their source', async () => {
      // Lesson 5 text set: '• A short, excerpt from “The Hare and the Lion” in Zanzibar Tales: ...,
      // translated by ...' followed by an all-caps note to the writer.
      const { texts } = await frontMatterFor(5)
      const others = texts.filter((text) => text.kind !== 'novel')
      expect(others).toEqual([
        {
          title: 'The Hare and the Lion',
          source:
            'Zanzibar Tales: Told by Natives of the East Coast of Africa, translated by George W. Bateman',
          kind: 'short_form',
        },
      ])
    })

    it('makes one text per Text Set Choice bullet', async () => {
      // Lesson 1 text set: two bullets, a library article and three short passages.
      const { texts } = await frontMatterFor(1)
      const others = texts.filter((text) => text.kind !== 'novel')
      expect(others).toHaveLength(2)
      expect(others[0]).toEqual(expect.objectContaining({ title: 'What Are Myths?' }))
      expect(others[1]!.title).toContain('Prometheus/Pandora')
      others.forEach((text) => expect(text.title).not.toMatch(/^•/))
    })
  })
})
