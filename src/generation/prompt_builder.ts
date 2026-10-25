// Builds one lesson's prompt from its outline row and context (R5, R7, R8, R10).
// Contract: src/generation/README.md.
import { lessonDurationMinutes, lessonTypeFromOutline } from '../lesson/schema'
import type { PromptTemplate } from './prompt_template'

export type StandardKind = 'focus' | 'supporting' | 'media' | 'eld'

export interface LessonPromptInput {
  promptVersion: { id: string; version: number; template: PromptTemplate }
  unit: {
    grade: number
    unitNumber: number
    anchorTextTitle: string
    /** The anchor text's author from the outline banner, when it names one. */
    author?: string | null
  }
  arc: { name: string; description: string } | null
  lesson: {
    id: string
    lessonNumber: number | null
    isFlex: boolean
    lessonType: string
    days: number
    filename: string
    textDependentQuestion: string
    description: string
    textSet: string
    homework: string
    performanceTaskSkill: string
    foundationalSkills: string
    vocabulary: string
  }
  standards: { code: string; kind: StandardKind; text: string | null }[]
  previousLesson: { lessonNumber: number | null; description: string } | null
  nextLesson: { lessonNumber: number | null; description: string } | null
  /** Non-empty ELD input fields for this lesson (R5). */
  eldInput: Record<string, string> | null
}

export interface LessonPrompt {
  system: string
  prompt: string
  promptVersionId: string
}

const STANDARD_HEADINGS: Record<StandardKind, string> = {
  focus: 'Focus standards (assessed; tag each on a Learning in Action part)',
  supporting: 'Supporting standards',
  media: 'Media literacy standards (treat as supporting)',
  eld: 'Designated ELD standards (drive the language objective and ELD blocks)',
}

/**
 * A code the outline lists as focus and again as additional is a focus standard only (R7), so it is
 * listed once.
 */
export function withoutFocusDuplicates<T extends { code: string; kind: StandardKind }>(
  standards: T[],
): T[] {
  const focus = new Set(standards.filter((s) => s.kind === 'focus').map((s) => s.code))
  return standards.filter((standard) => standard.kind === 'focus' || !focus.has(standard.code))
}

const PULSE_CHECK_LETTERS = ['A', 'B', 'C', 'D'] as const
export type PulseCheckOption = (typeof PULSE_CHECK_LETTERS)[number]

/**
 * Where the pulse check's correct option goes in a lesson: cycles A-D by lesson number so
 * consecutive lessons differ (the model alone put it at C every time); flex days use A.
 */
export function pulseCheckCorrectOption(lessonNumber: number | null): PulseCheckOption {
  if (lessonNumber === null) {
    return 'A'
  }
  const index = (((lessonNumber - 1) % 4) + 4) % 4
  return PULSE_CHECK_LETTERS[index]!
}

function standardsSection(standards: LessonPromptInput['standards']): string {
  return (Object.keys(STANDARD_HEADINGS) as StandardKind[])
    .map((kind) => {
      const items = withoutFocusDuplicates(standards).filter((standard) => standard.kind === kind)
      if (items.length === 0) {
        return null
      }
      const lines = items.map((standard) =>
        standard.text
          ? `- ${standard.code}: ${standard.text}`
          : `- ${standard.code} (not in the reference data; use the code as given)`,
      )
      return `${STANDARD_HEADINGS[kind]}:\n${lines.join('\n')}`
    })
    .filter((section): section is string => section !== null)
    .join('\n\n')
}

function field(label: string, value: string): string | null {
  const trimmed = value.trim()
  return trimmed ? `- ${label}: ${trimmed}` : null
}

function neighbour(label: string, lesson: LessonPromptInput['previousLesson']): string {
  if (!lesson) {
    return `- ${label}: none`
  }
  return `- ${label} (lesson ${lesson.lessonNumber ?? 'flex'}): ${lesson.description}`
}

export function buildLessonPrompt(input: LessonPromptInput): LessonPrompt {
  const { template } = input.promptVersion
  const { lesson, unit } = input
  const lessonType = lessonTypeFromOutline(lesson.lessonType)
  const minutes = lessonDurationMinutes(lesson.days)
  const guidance = template.typeGuidance[lessonType]

  const system = [
    template.system,
    template.styleGuide ? `# Style guide\n\n${template.styleGuide}` : null,
  ]
    .filter(Boolean)
    .join('\n\n')

  const outline = [
    field('Lesson', lesson.isFlex ? 'flex day (no lesson number)' : `${lesson.lessonNumber}`),
    field('Type of lesson', lesson.lessonType),
    `- Days: ${lesson.days} (total duration ${minutes} minutes; section minutes must add up to exactly ${minutes})`,
    field('Text-dependent question', lesson.textDependentQuestion),
    field('Lesson description', lesson.description),
    field('Text set', lesson.textSet),
    field('Homework', lesson.homework),
    field('Skill or content needed for the performance task', lesson.performanceTaskSkill),
    field('Foundational skills focus', lesson.foundationalSkills),
    field('Vocabulary', lesson.vocabulary),
    field('File name', lesson.filename),
  ].filter(Boolean)

  const eld = Object.entries(input.eldInput ?? {})
    .filter(([, value]) => value.trim())
    .map(([key, value]) => `- ${key}: ${value.trim()}`)

  const prompt = [
    `Write the lesson body for this grade ${unit.grade} lesson (unit ${unit.unitNumber}, anchor text: *${unit.anchorTextTitle}*).`,
    input.arc ? `# Arc\n\n${input.arc.name}: ${input.arc.description || '(no description)'}` : null,
    `# Outline row\n\n${outline.join('\n')}`,
    `# Standards\n\n${standardsSection(input.standards) || 'None listed.'}`,
    eld.length > 0 ? `# ELD input from the author\n\n${eld.join('\n')}` : null,
    `# Neighbouring lessons\n\n${neighbour('Previous lesson', input.previousLesson)}\n${neighbour('Next lesson', input.nextLesson)}`,
    guidance ? `# Guidance for this lesson type (${lessonType})\n\n${guidance}` : null,
    `In every pulse check of this lesson, the correct answer is option ${pulseCheckCorrectOption(lesson.lessonNumber)}; the wrong options fill the other positions.`,
    `Return only the JSON lesson body. The front matter (number, arc, type, duration, standards, texts) is filled in from the outline, so do not repeat it.`,
  ]
    .filter(Boolean)
    .join('\n\n')

  return { system, prompt, promptVersionId: input.promptVersion.id }
}
