// Lesson content schema (D-016): the single source of truth for the model's structured output,
// validation of generated lessons and editor snapshots. Contract: src/lesson/README.md.
import { z } from 'zod'

/** Standard codes are not shape-restricted: RL.6.1, RH.6-8.1, LIB.6.2.1.a, ELD.PI.6.6.a ... */
const StandardCode = z.string().min(1)
const Id = z.string().min(1).optional()
/** Inline text: plain string with **bold** / *italic* only. */
const Text = z.string().min(1)

export const LessonType = z.enum([
  'spark',
  'core_reading',
  'core_writing',
  'academic_discussion',
  'writing',
  'presentation',
  'research',
  'flex',
  'other',
])
export type LessonType = z.infer<typeof LessonType>

export const Routine = z.enum([
  'turn_and_talk',
  'think_pair_share',
  'quick_write',
  'whole_class_discussion',
  'graffiti_table_talk',
  'language_study',
  'partner_reading_discussion',
  'modeled_writing',
  'socratic_seminar',
  'iterative_conversation_exchange',
  'rehearse_and_refine',
  'reflect_and_respond_dialogue',
  'sentence_expansion',
  'independent_choice_work',
  'other',
])

const RoutineBlock = z.object({
  type: z.literal('routine'),
  id: Id,
  routine: Routine,
  label: z.string().optional(),
})
const TeachBlock = z.object({ type: z.literal('teach'), id: Id, title: z.string().optional() })
const ParagraphBlock = z.object({ type: z.literal('paragraph'), id: Id, text: Text })
const SayBlock = z.object({ type: z.literal('say'), id: Id, text: Text })
const DirectionsBlock = z.object({ type: z.literal('directions'), id: Id, text: Text })
const AskBlock = z.object({ type: z.literal('ask'), id: Id, question: Text, exemplar: Text })
const ConnectionBlock = z.object({ type: z.literal('connection'), id: Id, text: Text })
const DisplayBlock = z.object({ type: z.literal('display'), id: Id, label: z.string(), text: Text })
const ListBlock = z.object({
  type: z.literal('list'),
  id: Id,
  intro: z.string().optional(),
  ordered: z.boolean().optional(),
  items: z.array(Text).min(1),
})
const TableBlock = z.object({
  type: z.literal('table'),
  id: Id,
  caption: z.string(),
  headers: z.array(z.string()).min(1),
  rows: z.array(z.array(z.string())).min(1),
})
const TeacherTipBlock = z.object({ type: z.literal('teacher_tip'), id: Id, text: Text })
const SentenceStarterBlock = z.object({ type: z.literal('sentence_starter'), id: Id, text: Text })

const PulseCheckBlock = z
  .object({
    type: z.literal('pulse_check'),
    id: Id,
    standards: z.array(StandardCode).min(1),
    stem: Text,
    options: z.array(z.object({ text: Text, correct: z.boolean(), rationale: Text })).length(4),
  })
  .superRefine((block, ctx) => {
    const correct = block.options.filter((option) => option.correct).length
    if (correct !== 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['options'],
        message: `A pulse check needs exactly one correct option, found ${correct}`,
      })
    }
  })

const CheckForUnderstandingBlock = z.object({
  type: z.literal('check_for_understanding'),
  id: Id,
  standards: z.array(StandardCode).optional(),
  prompt: Text,
  lookFors: z.array(Text).optional(),
})

const ReflectionBlock = z.object({
  type: z.literal('reflection'),
  id: Id,
  standards: z.array(StandardCode).optional(),
  prompt: Text,
  questions: z.array(Text).min(1),
})

const EldInstructionsBlock = z.object({
  type: z.literal('eld_instructions'),
  id: Id,
  purpose: Text,
  languageFocus: z.array(Text).optional(),
  beforeActivity: z.string().optional(),
  moves: z.array(Text).min(1),
  recasts: z.array(z.object({ studentSaid: Text, academic: Text })).optional(),
  frames: z.array(Text).min(1),
  assetMoves: z.array(Text).optional(),
  leveledFrames: z.object({ emerging: Text, expanding: Text, bridging: Text }).optional(),
  watchFor: z.array(z.object({ trigger: Text, prompt: Text })).min(1),
  successCriteria: z.array(Text).min(1),
})

const StudentSupportBlock = z.object({
  type: z.literal('student_support'),
  id: Id,
  title: z.string().optional(),
  rows: z
    .array(
      z.object({
        kind: z.enum(['struggling', 'extension']),
        focus: z.string(),
        tryThis: Text,
      }),
    )
    .min(1),
})

const RubricBlock = z.object({
  type: z.literal('rubric'),
  id: Id,
  title: Text,
  prompt: Text,
  levels: z.array(z.string()).min(2).max(4),
  criteria: z
    .array(
      z.object({
        name: Text,
        standard: StandardCode.optional(),
        descriptors: z.array(Text).min(1),
      }),
    )
    .min(1),
})

export const Block = z.discriminatedUnion('type', [
  RoutineBlock,
  TeachBlock,
  ParagraphBlock,
  SayBlock,
  DirectionsBlock,
  AskBlock,
  ConnectionBlock,
  DisplayBlock,
  ListBlock,
  TableBlock,
  TeacherTipBlock,
  SentenceStarterBlock,
  PulseCheckBlock,
  CheckForUnderstandingBlock,
  ReflectionBlock,
  EldInstructionsBlock,
  StudentSupportBlock,
  RubricBlock,
])
export type Block = z.infer<typeof Block>

export const BLOCK_TYPES = Block.options.map((option) => option.shape.type.value)

export const SectionKind = z.enum(['launch', 'literacy_lab', 'learning_in_action', 'look_back'])

export const Part = z.object({
  id: Id,
  label: z.string().optional(),
  title: z.string().optional(),
  standards: z.array(StandardCode).default([]),
  minutes: z.number().int().positive().optional(),
  purpose: z.string().optional(),
  blocks: z.array(Block).min(1),
})
export type Part = z.infer<typeof Part>

export const Section = z.object({
  id: Id,
  kind: SectionKind,
  minutes: z.number().int().positive(),
  purpose: Text,
  parts: z.array(Part).min(1),
})
export type Section = z.infer<typeof Section>

const Homework = z.object({
  intro: z.string().optional(),
  tasks: z.array(Text).min(1),
  teacherTip: z.string().optional(),
})

const VocabularyEntry = z.object({ term: Text, definition: Text })

/** Copied from the outline row, not generated. */
export const LessonFrontMatter = z
  .object({
    unitTitle: z.string(),
    /** Null for flex days. */
    number: z.number().int().positive().nullable(),
    arc: z.string(),
    type: LessonType,
    title: z.string(),
    durationMinutes: z.number().int().positive(),
    /** At least one, except on a flex day (the sample's flex rows list no standards). */
    focusStandards: z.array(StandardCode),
    supportingStandards: z.array(StandardCode),
    eldStandards: z.array(
      z.object({ code: StandardCode, levels: z.array(z.enum(['Em', 'Ex', 'Br'])).min(1) }),
    ),
    texts: z.array(
      z.object({
        title: z.string(),
        source: z.string().optional(),
        kind: z.enum(['novel', 'short_form', 'other']),
        pages: z.string().optional(),
      }),
    ),
  })
  .superRefine((frontMatter, ctx) => {
    if (frontMatter.type !== 'flex' && frontMatter.focusStandards.length === 0) {
      ctx.addIssue({
        code: 'too_small',
        origin: 'array',
        minimum: 1,
        inclusive: true,
        input: frontMatter.focusStandards,
        path: ['focusStandards'],
        message: 'Too small: expected array to have >=1 items (only a flex day may have none)',
      })
    }
  })
export type LessonFrontMatter = z.infer<typeof LessonFrontMatter>

/** What the model generates. */
export const LessonBody = z.object({
  title: Text,
  objectives: z.object({
    content: Text,
    language: Text,
    foundationalSkills: z.string().optional(),
  }),
  essentialQuestions: z.array(Text).min(1).max(2),
  connections: z.object({
    knowledgeBuilding: Text,
    enduringUnderstanding: Text,
    futureLessons: Text,
    unitPerformanceTask: Text,
  }),
  vocabulary: z.object({
    addressed: z.array(VocabularyEntry),
    support: z.array(VocabularyEntry),
  }),
  materials: z.array(Text),
  sections: z.array(Section).min(3),
  homework: Homework.nullable().default(null),
})
export type LessonBody = z.infer<typeof LessonBody>

export const LessonContent = z.object({
  schemaVersion: z.literal(1),
  frontMatter: LessonFrontMatter,
  body: LessonBody,
})
export type LessonContent = z.infer<typeof LessonContent>

export interface LessonValidationError {
  code:
    'schema' | 'minutes_total' | 'duration' | 'focus_standard_missing' | 'focus_standard_untagged'
  path: string
  message: string
}

export interface LessonExpectations {
  /** Focus standard codes from the outline row. */
  focusStandards: string[]
  /** `lessons.days`; a lesson is 50 minutes per day. */
  days: number
}

export type LessonValidationResult =
  { ok: true; lesson: LessonContent } | { ok: false; errors: LessonValidationError[] }

export const MINUTES_PER_DAY = 50

export function lessonDurationMinutes(days: number): number {
  return Math.round(MINUTES_PER_DAY * days)
}

function crossFieldErrors(
  lesson: LessonContent,
  { focusStandards, days }: LessonExpectations,
): LessonValidationError[] {
  const expected = lessonDurationMinutes(days)
  const errors: LessonValidationError[] = []

  const total = lesson.body.sections.reduce((sum, section) => sum + section.minutes, 0)
  if (total !== expected) {
    errors.push({
      code: 'minutes_total',
      path: 'body.sections',
      message: `Section minutes add up to ${total}, but the lesson must take exactly ${expected} minutes (${MINUTES_PER_DAY} x ${days} day${days === 1 ? '' : 's'}).`,
    })
  }

  if (lesson.frontMatter.durationMinutes !== expected) {
    errors.push({
      code: 'duration',
      path: 'frontMatter.durationMinutes',
      message: `Duration is ${lesson.frontMatter.durationMinutes} minutes, expected ${expected}.`,
    })
  }

  const frontMatterFocus = new Set(lesson.frontMatter.focusStandards)
  focusStandards
    .filter((code) => !frontMatterFocus.has(code))
    .forEach((code) =>
      errors.push({
        code: 'focus_standard_missing',
        path: 'frontMatter.focusStandards',
        message: `Focus standard ${code} from the outline is missing from the front matter.`,
      }),
    )

  const tagged = new Set(
    lesson.body.sections
      .filter((section) => section.kind === 'learning_in_action')
      .flatMap((section) => section.parts.flatMap((part) => part.standards)),
  )
  const allFocus = [...new Set([...focusStandards, ...lesson.frontMatter.focusStandards])]
  allFocus
    .filter((code) => !tagged.has(code))
    .forEach((code) =>
      errors.push({
        code: 'focus_standard_untagged',
        path: 'body.sections',
        message: `Focus standard ${code} is not tagged on any Learning in Action part (add it to a part's "standards").`,
      }),
    )

  return errors
}

/** Schema parse plus the R7 cross-field checks; every error is reported. */
export function validateLesson(
  content: unknown,
  expectations: LessonExpectations,
): LessonValidationResult {
  const parsed = LessonContent.safeParse(content)
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => {
        const path = issue.path.map(String).join('.')
        return {
          code: 'schema' as const,
          path: path || '(root)',
          message: `${path || '(root)'}: ${issue.message}`,
        }
      }),
    }
  }
  const errors = crossFieldErrors(parsed.data, expectations)
  if (errors.length > 0) {
    return { ok: false, errors }
  }
  return { ok: true, lesson: parsed.data }
}

/** JSON schema of `LessonBody` for structured output. */
export function lessonBodyJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(LessonBody) as Record<string, unknown>
}

/** Outline "Type of Lesson" cell -> LessonType (R8). */
export function lessonTypeFromOutline(raw: string): LessonType {
  const value = raw.trim().toLowerCase().replace(/\s+/g, ' ')
  if (value.startsWith('spark')) {
    return 'spark'
  }
  if (value.startsWith('core reading')) {
    return 'core_reading'
  }
  if (value.startsWith('core writing')) {
    return 'core_writing'
  }
  if (value.startsWith('academic discussion')) {
    return 'academic_discussion'
  }
  if (value.includes('flex')) {
    return 'flex'
  }
  if (value.startsWith('writing')) {
    return 'writing'
  }
  if (value.startsWith('presentation')) {
    return 'presentation'
  }
  if (value.startsWith('research')) {
    return 'research'
  }
  return 'other'
}
