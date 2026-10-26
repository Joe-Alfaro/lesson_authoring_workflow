// AI assist (R20 selection actions, R21 regenerate one section, R22 standards alignment). Nothing
// here writes the lesson: the reviewer applies a suggestion in the editor, as one Yjs transaction.
// Every model call is metered in assist_calls and counts against SPEND_CAP_USD.
// Contract: src/assist/README.md.
import { eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import type { Role } from '../auth/roles'
import type { Database } from '../db/client'
import { assistCalls, lessons, standards, units } from '../db/schema'
import { LlmOutputError } from '../generation/anthropic_client'
import {
  computeCostUsd,
  MODEL_PRICES,
  type LlmClient,
  type LlmRequest,
  type LlmUsage,
  type PriceTable,
} from '../generation/llm'
import { getTotalSpendUsd } from '../generation/service'
import { getGlobalSpendCapUsd } from '../generation/settings'
import { isUuid } from '../import/is_uuid'
import { BLOCK_LABELS, SECTION_NAMES } from '../lesson/labels'
import { LessonContent, Section } from '../lesson/schema'
import { LessonLockedError, LessonNotFoundError, WorkflowForbiddenError } from '../workflow/errors'
import { isEditableStatus } from '../workflow/transitions'
import {
  AssistBudgetError,
  AssistInputError,
  AssistOutputError,
  SectionNotFoundError,
} from './errors'
import { getAssistModel } from './settings'

export interface AssistDeps {
  db: Database
  llm: LlmClient
  /** Default getAssistModel(): ASSIST_MODEL, else the Haiku-class DEFAULT_MODEL. */
  model?: string
  /** Default MODEL_PRICES. */
  prices?: PriceTable
  /** Default getGlobalSpendCapUsd() (SPEND_CAP_USD, default 20). */
  globalCapUsd?: number
}

export interface AssistActor {
  id: string
  role: Role
}

export const SELECTION_ACTIONS = ['rewrite', 'shorten', 'simplify', 'instruction'] as const
export type SelectionAction = (typeof SELECTION_ACTIONS)[number]
type AssistKind = SelectionAction | 'section' | 'alignment'

export type AlignmentVerdict = 'addressed' | 'partly_addressed' | 'missing'

export interface AlignmentItem {
  code: string
  /** Full text from the standards table ('' when the code isn't in it). */
  text: string
  verdict: AlignmentVerdict
  reason: string
  evidence: { id: string; label: string }[]
}

const ASSIST_ROLES: Role[] = ['reviewer', 'approver', 'admin']
const MAX_CALLS = 2
const MAX_TOKENS = 16_000

// ---------- shared checks ----------

interface LoadedLesson {
  id: string
  grade: number
  content: LessonContent
}

/** Lesson exists, role, lock; in that order and before any model call (contract). */
async function loadLesson(
  db: Database,
  lessonId: string,
  actor: AssistActor,
): Promise<LoadedLesson> {
  const [row] = isUuid(lessonId)
    ? await db
        .select({
          id: lessons.id,
          status: lessons.status,
          content: lessons.content,
          grade: units.grade,
        })
        .from(lessons)
        .innerJoin(units, eq(units.id, lessons.unitId))
        .where(eq(lessons.id, lessonId))
    : []
  if (!row) {
    throw new LessonNotFoundError(lessonId)
  }
  if (!ASSIST_ROLES.includes(actor.role)) {
    throw new WorkflowForbiddenError('AI assist is for reviewers, approvers and admins.')
  }
  if (!isEditableStatus(row.status)) {
    throw new LessonLockedError(row.status)
  }
  const content = LessonContent.safeParse(row.content)
  if (!content.success) {
    // Never generated, or not a lesson: nothing for assist to work on.
    throw new AssistInputError('This lesson has no valid content to work on yet.')
  }
  return { id: row.id, grade: row.grade, content: content.data }
}

async function assertBudget(deps: AssistDeps): Promise<void> {
  const cap = deps.globalCapUsd ?? getGlobalSpendCapUsd()
  const spent = await getTotalSpendUsd(deps.db)
  if (spent >= cap) {
    throw new AssistBudgetError(spent, cap)
  }
}

type Checked<T> = { ok: true; value: T } | { ok: false; problem: string }

/**
 * Calls the model, meters every call, and gives an invalid answer one repair retry (at most two
 * calls); then AssistOutputError.
 */
async function callModel<T>(
  deps: AssistDeps,
  meta: { kind: AssistKind; lessonId: string; userId: string },
  request: Omit<LlmRequest, 'model'>,
  check: (output: unknown) => Checked<T>,
): Promise<{ value: T; costUsd: number }> {
  const model = deps.model ?? getAssistModel()
  let costUsd = 0
  let prompt = request.prompt

  async function meter(usage: LlmUsage) {
    const cost = computeCostUsd(model, usage, deps.prices ?? MODEL_PRICES)
    costUsd += cost
    await deps.db.insert(assistCalls).values({
      lessonId: meta.lessonId,
      userId: meta.userId,
      kind: meta.kind,
      model,
      tokensIn: usage.inputTokens,
      tokensOut: usage.outputTokens,
      costUsd: cost,
    })
  }

  for (let attempt = 1; attempt <= MAX_CALLS; attempt += 1) {
    let problem: string
    try {
      const response = await deps.llm.generateStructured({
        ...request,
        prompt,
        model,
        maxTokens: MAX_TOKENS,
      })
      await meter(response.usage)
      const checked = check(response.output)
      if (checked.ok) {
        return { value: checked.value, costUsd }
      }
      problem = checked.problem
    } catch (error) {
      if (!(error instanceof LlmOutputError)) {
        if (error instanceof AssistOutputError) throw error
        throw new AssistOutputError(
          `The AI service failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
      await meter(error.usage)
      problem = error.message
    }
    prompt = `${request.prompt}\n\nYour previous answer was not usable: ${problem}. Answer again, following the output format exactly.`
  }
  throw new AssistOutputError()
}

function issues(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join('.') || 'answer'}: ${issue.message}`)
    .join('; ')
}

// ---------- R20 selection ----------

const SelectionAnswer = z.object({ text: z.string() })

const ACTION_TASKS: Record<SelectionAction, (grade: number, instruction: string) => string> = {
  rewrite: () => 'Rewrite the selected text so it reads more clearly. Keep its meaning and length.',
  shorten: () => 'Shorten the selected text. Keep what a teacher needs to say or do.',
  simplify: (grade) =>
    `Simplify the selected text so a grade ${grade} student can follow it: shorter sentences, everyday words, the same meaning.`,
  instruction: (_grade, instruction) =>
    `Change the selected text as the reviewer asks: ${instruction}`,
}

export async function suggestSelection(
  deps: AssistDeps,
  input: {
    lessonId: string
    actor: AssistActor
    action: SelectionAction
    text: string
    instruction?: string
    blockId?: string
  },
): Promise<{ suggestion: string; costUsd: number }> {
  const lesson = await loadLesson(deps.db, input.lessonId, input.actor)
  if (!SELECTION_ACTIONS.includes(input.action)) {
    throw new AssistInputError(`"action" must be one of: ${SELECTION_ACTIONS.join(', ')}.`)
  }
  if (typeof input.text !== 'string' || input.text.trim() === '') {
    throw new AssistInputError('Select some text first.')
  }
  const instruction = typeof input.instruction === 'string' ? input.instruction.trim() : ''
  if (input.action === 'instruction' && instruction === '') {
    throw new AssistInputError('Write an instruction for the AI.')
  }
  await assertBudget(deps)

  const body = lesson.content.body
  const system = [
    `You edit one passage of a grade ${lesson.grade} English Language Arts lesson plan for teachers.`,
    'Return only the replacement for the selected text, as plain text. You may use **bold** and *italic*; no other Markdown, no quotes around it, no commentary.',
  ].join('\n')
  const prompt = [
    `Lesson: ${body.title}`,
    `Task: ${ACTION_TASKS[input.action](lesson.grade, instruction)}`,
    instruction && input.action !== 'instruction' ? `Reviewer's note: ${instruction}` : '',
    'Selected text:',
    '<<<',
    input.text,
    '>>>',
  ]
    .filter(Boolean)
    .join('\n')

  const { value, costUsd } = await callModel(
    deps,
    { kind: input.action, lessonId: lesson.id, userId: input.actor.id },
    { system, prompt, schema: z.toJSONSchema(SelectionAnswer) as Record<string, unknown> },
    (output) => {
      const parsed = SelectionAnswer.safeParse(output)
      if (!parsed.success) return { ok: false, problem: issues(parsed.error) }
      const text = parsed.data.text.trim()
      return text ? { ok: true, value: text } : { ok: false, problem: 'text is blank' }
    },
  )
  return { suggestion: value, costUsd }
}

// ---------- R21 regenerate a section ----------

const SectionAnswer = z.object({ section: z.unknown() })

function lessonIds(content: LessonContent, skipSectionId?: string): Set<string> {
  const ids = new Set<string>()
  content.body.sections.forEach((section) => {
    if (section.id) ids.add(section.id)
    if (section.id === skipSectionId) return
    section.parts.forEach((part) => {
      if (part.id) ids.add(part.id)
      part.blocks.forEach((block) => {
        if (block.id) ids.add(block.id)
      })
    })
  })
  return ids
}

/** Keeps the section's place (id, kind, minutes); fresh ids where missing or colliding. */
function normaliseSection(
  raw: unknown,
  current: Section,
  content: LessonContent,
): Checked<Section> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, problem: 'section must be an object' }
  }
  const parsed = Section.safeParse({
    ...raw,
    id: current.id,
    kind: current.kind,
    minutes: current.minutes,
  })
  if (!parsed.success) return { ok: false, problem: issues(parsed.error) }
  const used = lessonIds(content, current.id)
  const fresh = (id: string | undefined) => {
    const next = id && !used.has(id) ? id : globalThis.crypto.randomUUID()
    used.add(next)
    return next
  }
  const section: Section = {
    ...parsed.data,
    parts: parsed.data.parts.map((part) => ({
      ...part,
      id: fresh(part.id),
      blocks: part.blocks.map((block) => ({ ...block, id: fresh(block.id) })),
    })),
  }
  const merged = {
    ...content,
    body: {
      ...content.body,
      sections: content.body.sections.map((s) => (s.id === current.id ? section : s)),
    },
  }
  const lesson = LessonContent.safeParse(merged)
  return lesson.success
    ? { ok: true, value: section }
    : { ok: false, problem: issues(lesson.error) }
}

export async function regenerateSection(
  deps: AssistDeps,
  input: { lessonId: string; actor: AssistActor; sectionId: string; instruction?: string },
): Promise<{ section: Section; costUsd: number }> {
  const lesson = await loadLesson(deps.db, input.lessonId, input.actor)
  const current = lesson.content.body.sections.find((section) => section.id === input.sectionId)
  if (!current) {
    throw new SectionNotFoundError(String(input.sectionId))
  }
  await assertBudget(deps)

  const instruction = typeof input.instruction === 'string' ? input.instruction.trim() : ''
  const name = SECTION_NAMES[current.kind]
  const { frontMatter, body } = lesson.content
  const system = [
    `You rewrite one section of a grade ${lesson.grade} English Language Arts lesson plan for teachers.`,
    `Rewrite only the ${name} section. Keep its kind "${current.kind}" and its ${current.minutes} minutes; it must fit the lesson around it.`,
    'Inline text may use **bold** and *italic* only. Return the whole section as {"section": {...}}.',
  ].join('\n')
  const prompt = [
    `Lesson: ${body.title}`,
    `Focus standards: ${frontMatter.focusStandards.join(', ') || 'none'}`,
    `Other sections: ${body.sections
      .filter((section) => section.id !== current.id)
      .map(
        (section) => `${SECTION_NAMES[section.kind]} (${section.minutes} min): ${section.purpose}`,
      )
      .join(' | ')}`,
    instruction
      ? `Reviewer's instruction: ${instruction}`
      : 'Reviewer gave no instruction: improve it.',
    `Current ${name} section:`,
    JSON.stringify(current),
  ].join('\n')

  const { value, costUsd } = await callModel(
    deps,
    { kind: 'section', lessonId: lesson.id, userId: input.actor.id },
    {
      system,
      prompt,
      schema: z.toJSONSchema(z.object({ section: Section })) as Record<string, unknown>,
    },
    (output) => {
      const parsed = SectionAnswer.safeParse(output)
      if (!parsed.success) return { ok: false, problem: issues(parsed.error) }
      return normaliseSection(parsed.data.section, current, lesson.content)
    },
  )
  return { section: value, costUsd }
}

// ---------- R22 alignment ----------

const AlignmentAnswer = z.object({
  standards: z.array(
    z.object({
      code: z.string(),
      verdict: z.enum(['addressed', 'partly_addressed', 'missing']),
      reason: z.string(),
      evidence: z.array(z.string()).default([]),
    }),
  ),
})

/** Labels of every section, part and block id, as the evidence chips name them. */
function evidenceLabels(content: LessonContent): Map<string, string> {
  const labels = new Map<string, string>()
  content.body.sections.forEach((section) => {
    const sectionName = SECTION_NAMES[section.kind]
    if (section.id) labels.set(section.id, sectionName)
    section.parts.forEach((part, index) => {
      const where =
        section.kind === 'learning_in_action' ? `Part ${part.label || index + 1}` : sectionName
      if (part.id) labels.set(part.id, where)
      part.blocks.forEach((block) => {
        if (block.id) labels.set(block.id, `${where}, ${BLOCK_LABELS[block.type]}`)
      })
    })
  })
  return labels
}

export async function checkAlignment(
  deps: AssistDeps,
  input: { lessonId: string; actor: AssistActor },
): Promise<{ checkedAt: Date; standards: AlignmentItem[]; costUsd: number }> {
  const lesson = await loadLesson(deps.db, input.lessonId, input.actor)
  await assertBudget(deps)

  const focus = lesson.content.frontMatter.focusStandards
  const rows = focus.length
    ? await deps.db
        .select({ code: standards.code, text: standards.text })
        .from(standards)
        .where(inArray(standards.code, focus))
    : []
  const fullText = new Map(rows.map((row) => [row.code, row.text]))
  const labels = evidenceLabels(lesson.content)

  const system = [
    `You check a grade ${lesson.grade} English Language Arts lesson plan against its focus standards.`,
    'For each focus standard, judge whether the lesson asks students to do what the standard requires: "addressed", "partly_addressed" or "missing".',
    'Give a one or two sentence reason, and as evidence the ids ("id" fields) of the sections, parts or blocks that address it. Do not invent ids. List every focus standard once.',
  ].join('\n')
  const prompt = [
    'Focus standards:',
    ...focus.map((code) => `- ${code}: ${fullText.get(code) ?? '(text not in the reference)'}`),
    '',
    'Lesson (JSON, with ids):',
    JSON.stringify(lesson.content.body),
  ].join('\n')

  const { value, costUsd } = await callModel(
    deps,
    { kind: 'alignment', lessonId: lesson.id, userId: input.actor.id },
    { system, prompt, schema: z.toJSONSchema(AlignmentAnswer) as Record<string, unknown> },
    (output): Checked<AlignmentItem[]> => {
      const parsed = AlignmentAnswer.safeParse(output)
      if (!parsed.success) return { ok: false, problem: issues(parsed.error) }
      const byCode = new Map(parsed.data.standards.map((item) => [item.code, item]))
      const missing = focus.filter((code) => !byCode.has(code))
      if (missing.length) {
        return { ok: false, problem: `no verdict for ${missing.join(', ')}` }
      }
      return {
        ok: true,
        value: focus.map((code) => {
          const item = byCode.get(code)!
          return {
            code,
            text: fullText.get(code) ?? '',
            verdict: item.verdict,
            reason: item.reason.trim(),
            evidence: [...new Set(item.evidence)]
              .filter((id) => labels.has(id))
              .map((id) => ({ id, label: labels.get(id)! })),
          }
        }),
      }
    },
  )
  return { checkedAt: new Date(), standards: value, costUsd }
}
