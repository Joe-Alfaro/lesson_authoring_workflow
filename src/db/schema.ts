import { sql } from 'drizzle-orm'
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import type { EldFields, EldRow } from '../import/parse_eld'
import type { ImportWarning, ParsedOutline } from '../import/parse_outline'

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType() {
    return 'bytea'
  },
  toDriver(value) {
    return Buffer.from(value)
  },
  fromDriver(value) {
    return new Uint8Array(value)
  },
})

function createdAt() {
  return timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}

function usd(name: string) {
  return numeric(name, { precision: 12, scale: 6, mode: 'number' })
}

export const userRole = pgEnum('user_role', ['author', 'reviewer', 'approver', 'admin'])

// R23. Labels for the UI: Generating, Draft, In review, Changes requested, Approved, Failed.
export const lessonStatus = pgEnum('lesson_status', [
  'generating',
  'draft',
  'in_review',
  'changes_requested',
  'approved',
  'failed',
])

export const standardFramework = pgEnum('standard_framework', [
  'CCSS_ELA',
  'CA_ELD',
  'CA_SCHOOL_LIBRARY',
])

export const lessonStandardKind = pgEnum('lesson_standard_kind', [
  'focus',
  'supporting',
  'media',
  'eld',
])

export const generationRunStatus = pgEnum('generation_run_status', [
  'queued',
  'running',
  'completed',
  'cancelled',
  'stopped_cap',
  'failed',
])

// R9 statuses as shown on the unit page.
export const generationJobStatus = pgEnum('generation_job_status', [
  'queued',
  'generating',
  'generated',
  'failed',
  'cancelled',
])

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  role: userRole('role').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: createdAt(),
})

export const units = pgTable('units', {
  id: uuid('id').primaryKey().defaultRandom(),
  grade: integer('grade').notNull(),
  unitNumber: integer('unit_number').notNull(),
  anchorTextTitle: text('anchor_text_title').notNull(),
  isbn: text('isbn'),
  banner: text('banner').notNull(),
  /** ELD rows that matched no lesson, from the last attached ELD file (R5, D-028). */
  eldWarnings: jsonb('eld_warnings').$type<ImportWarning[]>().notNull().default([]),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: createdAt(),
})

export const arcs = pgTable(
  'arcs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    position: integer('position').notNull(),
  },
  (table) => [uniqueIndex('arcs_unit_position_idx').on(table.unitId, table.position)],
)

export const lessons = pgTable(
  'lessons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'cascade' }),
    arcId: uuid('arc_id').references(() => arcs.id, { onDelete: 'set null' }),
    // Row order in the outline; flex days have no lesson number, so this keeps them in place.
    position: integer('position').notNull(),
    filename: text('filename').notNull().default(''),
    lessonNumber: integer('lesson_number'),
    lessonType: text('lesson_type').notNull().default(''),
    days: numeric('days', { precision: 4, scale: 1, mode: 'number' }).notNull().default(1),
    textDependentQuestion: text('text_dependent_question').notNull().default(''),
    description: text('description').notNull().default(''),
    textSet: text('text_set').notNull().default(''),
    homework: text('homework').notNull().default(''),
    // Raw outline cells; normalized codes live in lesson_standards.
    focusStandards: text('focus_standards').notNull().default(''),
    supportingStandards: text('supporting_standards').notNull().default(''),
    mediaLiteracyStandards: text('media_literacy_standards').notNull().default(''),
    performanceTaskSkill: text('performance_task_skill').notNull().default(''),
    foundationalSkills: text('foundational_skills').notNull().default(''),
    vocabulary: text('vocabulary').notNull().default(''),
    eldStandards: text('eld_standards').notNull().default(''),
    rawRow: jsonb('raw_row').$type<Record<string, string>>().notNull(),
    isFlex: boolean('is_flex').notNull().default(false),
    // R3: warnings from the import (unknown standard codes), shown on the lesson.
    importWarnings: jsonb('import_warnings').$type<ImportWarning[]>().notNull().default([]),
    // R5: non-empty fields of the matched ELD scope-and-sequence row; null when none.
    eldInput: jsonb('eld_input').$type<EldFields>(),
    // A lesson that has not been generated yet is a Draft with null content.
    status: lessonStatus('status').notNull().default('draft'),
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    content: jsonb('content').$type<unknown>(),
    // D-055 (4): non-blocking review hints from the last generation (polishHints), shown to reviewers.
    polishWarnings: jsonb('polish_warnings').$type<string[]>().notNull().default([]),
    lastEditedBy: uuid('last_edited_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('lessons_unit_position_idx').on(table.unitId, table.position),
    uniqueIndex('lessons_unit_number_idx')
      .on(table.unitId, table.lessonNumber)
      .where(sql`${table.lessonNumber} is not null`),
    index('lessons_assignee_idx').on(table.assigneeId),
  ],
)

// R4: a parsed outline waiting for the author to confirm or cancel it; confirming or cancelling
// deletes the row, so a pending import never becomes a unit on its own.
export const pendingImports = pgTable('pending_imports', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'cascade' }),
  payload: jsonb('payload').$type<PendingImportPayload>().notNull(),
  createdAt: createdAt(),
})

export interface PendingImportPayload {
  outline: ParsedOutline
  /** Per outline item, in `outline.items` order. */
  standards: {
    codes: Record<'focus' | 'supporting' | 'media' | 'eld', string[]>
    warnings: ImportWarning[]
  }[]
  /** An ELD file attached at import time (R5); matched to lessons on confirm. */
  eld?: { rows: EldRow[] }
}

export const lessonVersions = pgTable(
  'lesson_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    lessonId: uuid('lesson_id')
      .notNull()
      .references(() => lessons.id, { onDelete: 'cascade' }),
    content: jsonb('content').$type<unknown>().notNull(),
    // Null when the version came from generation rather than a person.
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    // Everyone else who edited since the previous version (collab idle versions, R14).
    contributorIds: uuid('contributor_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    createdAt: createdAt(),
  },
  (table) => [index('lesson_versions_lesson_idx').on(table.lessonId, table.createdAt)],
)

export const standards = pgTable('standards', {
  code: text('code').primaryKey(),
  framework: standardFramework('framework').notNull(),
  grade: integer('grade').notNull(),
  strand: text('strand').notNull(),
  text: text('text').notNull(),
  // Source fields beyond the core ones, e.g. ELD proficiency levels or the outline's short code.
  details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
})

// No foreign key to standards: R3 keeps codes missing from the reference data and flags them.
export const lessonStandards = pgTable(
  'lesson_standards',
  {
    lessonId: uuid('lesson_id')
      .notNull()
      .references(() => lessons.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    kind: lessonStandardKind('kind').notNull(),
    position: integer('position').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.lessonId, table.kind, table.code] }),
    index('lesson_standards_code_idx').on(table.code),
  ],
)

export const promptVersions = pgTable(
  'prompt_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    template: text('template').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('prompt_versions_unit_version_idx').on(table.unitId, table.version)],
)

export const generationRuns = pgTable(
  'generation_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'cascade' }),
    model: text('model').notNull(),
    promptVersionId: uuid('prompt_version_id')
      .notNull()
      .references(() => promptVersions.id),
    capUsd: usd('cap_usd').notNull(),
    costUsd: usd('cost_usd').notNull().default(0),
    status: generationRunStatus('status').notNull().default('queued'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => [index('generation_runs_unit_idx').on(table.unitId, table.createdAt)],
)

export const generationJobs = pgTable(
  'generation_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => generationRuns.id, { onDelete: 'cascade' }),
    lessonId: uuid('lesson_id')
      .notNull()
      .references(() => lessons.id, { onDelete: 'cascade' }),
    status: generationJobStatus('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
    tokensIn: integer('tokens_in').notNull().default(0),
    tokensOut: integer('tokens_out').notNull().default(0),
    costUsd: usd('cost_usd').notNull().default(0),
    // D-055 (3): one lesson estimate while the job is in flight, 0 otherwise; spend guards count it.
    reservedUsd: usd('reserved_usd').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('generation_jobs_run_lesson_idx').on(table.runId, table.lessonId),
    index('generation_jobs_lesson_idx').on(table.lessonId),
  ],
)

export const workflowEvents = pgTable(
  'workflow_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    lessonId: uuid('lesson_id')
      .notNull()
      .references(() => lessons.id, { onDelete: 'cascade' }),
    // Null for the first event of a lesson.
    fromStatus: lessonStatus('from_status'),
    toStatus: lessonStatus('to_status').notNull(),
    // Null when the system (generation) made the transition.
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    note: text('note'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('workflow_events_lesson_idx').on(table.lessonId, table.at)],
)

export const yjsDocuments = pgTable('yjs_documents', {
  name: text('name').primaryKey(),
  state: bytea('state').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Who assigned a lesson to whom, and when (R23 history, R25). */
export const assignmentEvents = pgTable(
  'assignment_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    lessonId: uuid('lesson_id')
      .notNull()
      .references(() => lessons.id, { onDelete: 'cascade' }),
    // Null when the lesson was unassigned.
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('assignment_events_lesson_idx').on(table.lessonId, table.at)],
)

/** One row per AI assist model call, retries included (R20-R22); counts in SPEND_CAP_USD. */
export const assistCalls = pgTable(
  'assist_calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Spend stays counted after its lesson or user is deleted.
    lessonId: uuid('lesson_id').references(() => lessons.id, { onDelete: 'set null' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    kind: text('kind').notNull(),
    model: text('model').notNull(),
    tokensIn: integer('tokens_in').notNull(),
    tokensOut: integer('tokens_out').notNull(),
    costUsd: usd('cost_usd').notNull(),
    createdAt: createdAt(),
  },
  (table) => [index('assist_calls_lesson_idx').on(table.lessonId, table.createdAt)],
)

export type Role = (typeof userRole.enumValues)[number]
export type LessonStatus = (typeof lessonStatus.enumValues)[number]
export type StandardFramework = (typeof standardFramework.enumValues)[number]
