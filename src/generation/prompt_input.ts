// Loads a lesson's prompt input from the database (R5, R7, R10). Contract: src/generation/README.md.
import { and, asc, desc, eq, gt, isNotNull, lt } from 'drizzle-orm'
import type { Database } from '../db/client'
import { arcs, lessons, lessonStandards, standards, units } from '../db/schema'
import { getLessonEldInput } from '../import/eld_service'
import type { LessonPromptInput, StandardKind } from './prompt_builder'
import { getCurrentPromptVersion, getPromptVersion } from './prompt_versions'

export type GetEldInput = (db: Database, lessonId: string) => Promise<Record<string, string> | null>

/** M1's stored ELD input (R5), non-empty fields only. */
const storedEldInput: GetEldInput = async (db, lessonId) => {
  const fields = await getLessonEldInput(db, lessonId)
  if (!fields) {
    return null
  }
  const entries = Object.entries(fields).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim() !== '',
  )
  return entries.length > 0 ? Object.fromEntries(entries) : null
}

const KIND_ORDER: StandardKind[] = ['focus', 'supporting', 'media', 'eld']

export class LessonNotFoundError extends Error {
  constructor(readonly lessonId: string) {
    super(`Lesson ${lessonId} not found`)
    this.name = 'LessonNotFoundError'
  }
}

async function neighbour(
  db: Database,
  unitId: string,
  position: number,
  direction: 'previous' | 'next',
): Promise<LessonPromptInput['previousLesson']> {
  const [row] = await db
    .select({ lessonNumber: lessons.lessonNumber, description: lessons.description })
    .from(lessons)
    .where(
      and(
        eq(lessons.unitId, unitId),
        isNotNull(lessons.lessonNumber),
        direction === 'previous' ? lt(lessons.position, position) : gt(lessons.position, position),
      ),
    )
    .orderBy(direction === 'previous' ? desc(lessons.position) : asc(lessons.position))
    .limit(1)
  return row ?? null
}

export async function loadLessonPromptInput(
  db: Database,
  lessonId: string,
  options: { promptVersionId?: string; getEldInput?: GetEldInput } = {},
): Promise<LessonPromptInput> {
  const [row] = await db
    .select({ lesson: lessons, unit: units, arc: arcs })
    .from(lessons)
    .innerJoin(units, eq(units.id, lessons.unitId))
    .leftJoin(arcs, eq(arcs.id, lessons.arcId))
    .where(eq(lessons.id, lessonId))
  if (!row) {
    throw new LessonNotFoundError(lessonId)
  }
  const { lesson, unit, arc } = row

  const promptVersion = options.promptVersionId
    ? await getPromptVersion(db, options.promptVersionId)
    : await getCurrentPromptVersion(db, unit.id)
  if (!promptVersion) {
    throw new Error(`Prompt version ${options.promptVersionId} not found`)
  }

  const standardRows = await db
    .select({ code: lessonStandards.code, kind: lessonStandards.kind, text: standards.text })
    .from(lessonStandards)
    .leftJoin(standards, eq(standards.code, lessonStandards.code))
    .where(eq(lessonStandards.lessonId, lessonId))
    .orderBy(asc(lessonStandards.position), asc(lessonStandards.code))
  const sortedStandards = [...standardRows].sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
  )

  const [previousLesson, nextLesson, eldInput] = await Promise.all([
    neighbour(db, unit.id, lesson.position, 'previous'),
    neighbour(db, unit.id, lesson.position, 'next'),
    (options.getEldInput ?? storedEldInput)(db, lessonId),
  ])

  return {
    promptVersion: {
      id: promptVersion.id,
      version: promptVersion.version,
      template: promptVersion.template,
    },
    unit: { grade: unit.grade, unitNumber: unit.unitNumber, anchorTextTitle: unit.anchorTextTitle },
    arc: arc ? { name: arc.name, description: arc.description } : null,
    lesson: {
      id: lesson.id,
      lessonNumber: lesson.lessonNumber,
      isFlex: lesson.isFlex,
      lessonType: lesson.lessonType,
      days: lesson.days,
      filename: lesson.filename,
      textDependentQuestion: lesson.textDependentQuestion,
      description: lesson.description,
      textSet: lesson.textSet,
      homework: lesson.homework,
      performanceTaskSkill: lesson.performanceTaskSkill,
      foundationalSkills: lesson.foundationalSkills,
      vocabulary: lesson.vocabulary,
    },
    standards: sortedStandards,
    previousLesson,
    nextLesson,
    eldInput,
  }
}
