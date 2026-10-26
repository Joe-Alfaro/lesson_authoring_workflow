// Display names for lesson schema values (editor, lesson view, export).
import type { Block, LessonType, Section } from './schema'

export type SectionKind = Section['kind']

export const SECTION_NAMES: Record<SectionKind, string> = {
  launch: 'Launch',
  literacy_lab: 'Literacy Lab',
  learning_in_action: 'Learning in Action',
  look_back: 'Look Back',
}

/** Short names for tight spaces (the lesson view's section chips at 390 wide). */
export const SECTION_SHORT_NAMES: Record<SectionKind, string> = {
  launch: 'Launch',
  literacy_lab: 'Lab',
  learning_in_action: 'In Action',
  look_back: 'Look Back',
}

/** Class of a section's pacing colour (STYLE.md: ribbon, rail, headings, gutters). */
export const SECTION_COLOURS: Record<SectionKind, string> = {
  launch: 'launch',
  literacy_lab: 'lab',
  learning_in_action: 'action',
  look_back: 'lookback',
}

/** In-page anchor of a section. */
export function sectionAnchor(kind: SectionKind | 'homework'): string {
  return kind === 'homework' ? 'sec-homework' : `sec-${SECTION_COLOURS[kind]}`
}

export const LESSON_TYPE_NAMES: Record<LessonType, string> = {
  spark: 'Spark',
  core_reading: 'Core Reading',
  core_writing: 'Core Writing',
  academic_discussion: 'Academic Discussion',
  writing: 'Writing',
  presentation: 'Presentation',
  research: 'Research',
  flex: 'Flex Day',
  other: 'Lesson',
}

const ROUTINE_NAMES: Record<string, string> = {
  turn_and_talk: 'Turn and Talk',
  think_pair_share: 'Think-Pair-Share',
  quick_write: 'Quick Write',
  whole_class_discussion: 'Whole-Class Discussion',
  graffiti_table_talk: 'Graffiti Table Talk',
  language_study: 'Language Study',
  partner_reading_discussion: 'Partner Reading & Discussion',
  modeled_writing: 'Modeled Writing',
  socratic_seminar: 'Socratic Seminar',
  iterative_conversation_exchange: 'Iterative Conversation Exchange',
  rehearse_and_refine: 'Rehearse and Refine',
  reflect_and_respond_dialogue: 'Reflect and Respond Dialogue',
  sentence_expansion: 'Sentence Expansion',
  independent_choice_work: 'Independent Choice Work',
  other: 'Routine',
}

export function routineName(routine: string): string {
  return ROUTINE_NAMES[routine] ?? routine
}

/** "Lesson 4" or "Flex day" (flex days have no number). */
export function lessonLabel(number: number | null): string {
  return number === null ? 'Flex day' : `Lesson ${number}`
}

export function minutesLabel(minutes: number): string {
  return `${minutes} min`
}

/** A block's visible label in the editor gutter or box title (R22 evidence chips). */
export const BLOCK_LABELS: Record<Block['type'], string> = {
  routine: 'Routine',
  teach: 'Teach',
  paragraph: 'Teacher',
  say: 'Say',
  directions: 'Directions',
  ask: 'Ask',
  connection: 'Connection',
  display: 'Display',
  list: 'List',
  table: 'Table',
  teacher_tip: 'Teacher tip',
  sentence_starter: 'Starter',
  pulse_check: 'Pulse check',
  check_for_understanding: 'Check for understanding',
  reflection: 'Reflection',
  eld_instructions: 'Integrated ELD instructions',
  student_support: 'Additional student support',
  rubric: 'Rubric',
}

/** "Part A: Title". Generated labels already say "Part A"; only a bare letter gets "Part". */
export function partName(label: string | undefined, title: string | undefined): string {
  const name = label ? (/^[A-Z0-9]{1,2}$/i.test(label) ? `Part ${label}` : label) : ''
  return [name, title].filter(Boolean).join(': ')
}

/** "Unit 4: The Lightning Thief"; generation already puts "Unit 4:" in the unit title. */
export function unitKicker(unitNumber: number, unitTitle: string): string {
  return /^unit\s+\d+/i.test(unitTitle.trim())
    ? unitTitle.trim()
    : `Unit ${unitNumber}: ${unitTitle}`
}
