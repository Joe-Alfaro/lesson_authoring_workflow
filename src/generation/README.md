# Lesson generation (M2: R6-R12)

The tests in this folder (and `src/app/api/units/[id]/generation/events/route.int.test.ts`) were
written first (red) and define this contract. Names, file paths and return shapes are what the
tests import; anything not listed is up to the implementation. The lesson schema is in
`src/lesson/README.md`.

**No test calls a real model.** Every `LlmClient` in tests is `tests/fake_llm.ts`; the Anthropic
adapter is only constructed by `src/worker/main.ts`.

## Modules

| File                                                | Exports                                                                                                                                                                                      | Kind      |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `src/generation/llm.ts`                             | `LlmClient`, `LlmRequest`, `LlmResponse`, `LlmUsage`, `PriceTable`, `MODEL_PRICES`, `DEFAULT_MODEL`, `computeCostUsd`, `estimateCostUsd`, `ESTIMATED_TOKENS_PER_LESSON`, `UnknownModelError` | pure      |
| `src/generation/anthropic_client.ts`                | `createAnthropicLlmClient({ apiKey })`: `LlmClient` (not unit tested; never used in tests)                                                                                                   | SDK       |
| `src/generation/settings.ts`                        | `getGenerationSettings(env = process.env)`                                                                                                                                                   | pure      |
| `src/generation/prompt_template.ts`                 | `PromptTemplate` (Zod schema + type), `DEFAULT_PROMPT_TEMPLATE`                                                                                                                              | pure      |
| `src/generation/prompt_builder.ts`                  | `buildLessonPrompt(input)`, `LessonPromptInput`                                                                                                                                              | pure      |
| `src/generation/prompt_input.ts`                    | `loadLessonPromptInput(db, lessonId, { promptVersionId?, getEldInput? })`                                                                                                                    | DB        |
| `src/generation/prompt_versions.ts`                 | `getCurrentPromptVersion`, `savePromptVersion`, `listPromptVersions`, `getPromptVersion`                                                                                                     | DB        |
| `src/generation/queue.ts`                           | `GENERATE_LESSON_QUEUE`, `ensureGenerationQueue(boss)`                                                                                                                                       | boss      |
| `src/generation/service.ts`                         | `startRun`, `estimateRunCost`, `generateFlexDay`, `cancelRun`, `regenerateLessons`, `getRun`, `getLessonGeneration`, `runStatusLabel`, `HumanEditsError`, `GenerationDeps`                   | DB + boss |
| `src/generation/worker.ts`                          | `registerGenerationWorker(options): Promise<GenerationWorker>`                                                                                                                               | boss      |
| `src/generation/progress.ts`                        | `getUnitProgress(db, unitId)`, `subscribeToUnitProgress(db, unitId, listener)`, `LessonProgressEvent`                                                                                        | DB        |
| `src/app/api/units/[id]/generation/events/route.ts` | `GET` -> 200 `text/event-stream`, 404 for an unknown unit                                                                                                                                    | route     |

`src/worker/worker.ts` (`startWorker`) should call `registerGenerationWorker` with the Anthropic
client and `getGenerationSettings()`; that wiring is not covered by these tests.

## LLM client (`llm.ts`)

```ts
interface LlmRequest {
  model: string
  system: string
  prompt: string
  schema: Record<string, unknown>
  maxTokens?: number
}
interface LlmUsage {
  inputTokens: number
  outputTokens: number
}
interface LlmResponse {
  output: unknown
  usage: LlmUsage
  model: string
}
interface LlmClient {
  generateStructured(request: LlmRequest): Promise<LlmResponse>
}
type PriceTable = Record<string, { inputPerMTok: number; outputPerMTok: number }> // USD per 1M tokens
```

- `computeCostUsd(model, usage, prices = MODEL_PRICES)` = in x inPrice / 1e6 + out x outPrice / 1e6;
  throws `UnknownModelError` for a model not in the table.
- `DEFAULT_MODEL` is a Haiku-class model id and is in `MODEL_PRICES`.
- `estimateCostUsd(model, lessonCount, prices?)` = `lessonCount x computeCostUsd(model,
ESTIMATED_TOKENS_PER_LESSON)`. Refine `ESTIMATED_TOKENS_PER_LESSON` after the first real run.
- `output` is the raw structured JSON; validation happens in the worker, not the client.
- The Anthropic adapter (D-034) puts the JSON schema in the system prompt and parses the JSON
  object from the text answer: structured outputs reject the lesson schema as too large, and as
  tool input the model sometimes sent `sections` as a malformed string. Thinking effort is
  `GENERATION_EFFORT` (default `medium`), output ceiling 64k tokens.
- Lesson status moves (Generating, Draft, Failed) go through `applySystemTransition` (M4), and
  the global budget `SPEND_CAP_USD` (default $20, all runs) is checked at run start and before
  every job.

## Settings (`settings.ts`)

`getGenerationSettings(env)` -> `{ model, concurrency, maxAttempts, capUsd }` from
`GENERATION_MODEL` (default `DEFAULT_MODEL`), `GENERATION_CONCURRENCY` (default 4, integer >= 1),
`GENERATION_MAX_ATTEMPTS` (default 2: one repair retry, integer >= 1), `GENERATION_SPEND_CAP_USD`
(default 5, number >= 0). Invalid values throw an error naming the variable.

## Prompt (`prompt_template.ts`, `prompt_builder.ts`, `prompt_input.ts`)

```ts
type PromptTemplate = { system: string; styleGuide: string; typeGuidance: Partial<Record<LessonType, string>> }
type LessonPromptInput = {
  promptVersion: { id: string; version: number; template: PromptTemplate }
  unit: { grade: number; unitNumber: number; anchorTextTitle: string }
  arc: { name: string; description: string } | null
  lesson: { id; lessonNumber: number | null; isFlex; lessonType; days; filename; textDependentQuestion;
            description; textSet; homework; performanceTaskSkill; foundationalSkills; vocabulary }
  standards: { code: string; kind: 'focus' | 'supporting' | 'media' | 'eld'; text: string | null }[]
  previousLesson: { lessonNumber: number | null; description: string } | null
  nextLesson: { lessonNumber: number | null; description: string } | null
  eldInput: Record<string, string> | null // M1 getLessonEldInput fields, non-empty only
}
buildLessonPrompt(input) -> { system: string; prompt: string; promptVersionId: string }
```

- `system` holds the template's `system` and `styleGuide`.
- `system + prompt` hold: every standard's code and full text (unknown codes by code), every
  outline field of the row and its raw lesson type, the duration (50 x days minutes), the arc
  description, the previous and next lesson descriptions, every ELD input field, and the
  `typeGuidance` entry for `lessonTypeFromOutline(lesson.lessonType)` **only** (no other type's
  guidance).
- **Previous/next lessons contribute only their lesson number and description** (tests identify a
  request by the lesson's Text Dependent Question).
- `DEFAULT_PROMPT_TEMPLATE` has guidance (> 20 chars) for spark, core_reading, core_writing,
  academic_discussion, writing and flex; Core Writing mentions teacher modeling and a "writing
  task", Academic Discussion a discussion "protocol" (R8). Write it from the private style guide in
  your own words; no example lesson text.
- `loadLessonPromptInput` reads `lessons`, `units`, `arcs`, `lesson_standards` joined to
  `standards` (text `null` when the code is not in the reference data). Neighbours are the
  adjacent **numbered** lessons by `position` (flex days are skipped; a flex day gets the numbered
  lessons around it). The prompt version is `promptVersionId` when given, else the unit's current
  one. `getEldInput(db, lessonId)` defaults to M1's `getLessonEldInput` once that is merged (until
  then, a function returning `null`).

## Prompt versions (`prompt_versions.ts`, R10)

```ts
type PromptVersion = { id; unitId; version: number; template: PromptTemplate; createdBy: string | null; createdAt: Date }
getCurrentPromptVersion(db, unitId): Promise<PromptVersion> // creates version 1 = DEFAULT_PROMPT_TEMPLATE if none
savePromptVersion(db, { unitId, template, userId? }): Promise<PromptVersion> // next version number; validates the template
listPromptVersions(db, unitId): Promise<PromptVersion[]> // ascending by version
getPromptVersion(db, id): Promise<PromptVersion | null>
```

Versions are numbered per unit from 1. An invalid template rejects and stores nothing. Storage in
`prompt_versions.template` (text) is up to the implementation (e.g. JSON).

## Service (`service.ts`, R6, R11, R12)

```ts
type GenerationDeps = { db: Database; boss: PgBoss; prices?: PriceTable } // prices default MODEL_PRICES
startRun(deps, { unitId, model?, capUsd?, userId? }) -> { runId, jobCount, estimatedUsd }
estimateRunCost(deps, { unitId, model? }) -> { lessonCount, estimatedUsd }
generateFlexDay(deps, { lessonId, model?, capUsd?, userId? }) -> { runId, jobCount }
regenerateLessons(deps, { unitId, lessonIds?: string[], failed?: true, model?, capUsd?, userId?, confirmOverwrite?: boolean })
  -> { runId, jobCount }
cancelRun(deps, runId) -> void
getRun(db, runId) -> RunView | null
getLessonGeneration(db, lessonId) -> { runId, model, promptVersionId, promptVersion, tokensIn, tokensOut, costUsd, generatedAt } | null
runStatusLabel(status) -> string // 'stopped_cap' -> 'stopped: spend cap reached', others unchanged

type RunView = { id; unitId; status; statusLabel; model; promptVersionId; capUsd: number; costUsd: number;
  finishedAt: Date | null; jobs: { id; lessonId; status; attempts; error: string | null; tokensIn; tokensOut; costUsd: number }[] }
```

- `model`/`capUsd` default to `getGenerationSettings()`. A model missing from `prices` rejects with
  `UnknownModelError` before anything is written.
- `startRun` creates a `generation_runs` row pinned to the current prompt version, one
  `generation_jobs` row per **numbered** lesson (never flex days) and one pg-boss job each, then
  returns. It never calls the model. `generateFlexDay` does the same for one flex day.
- `regenerateLessons` uses the current prompt version; `failed: true` selects the lessons whose
  latest job failed. If any selected lesson has human edits (`lessons.last_edited_by` is set) and
  `confirmOverwrite` is not `true`, it rejects with `HumanEditsError` (`lessonIds` = those lessons)
  and creates no run. When overwriting, the current content is kept in `lesson_versions` (author =
  the last editor) before the new content is saved.
- Run status: `queued` -> `running` -> `completed` when every job is `generated` or `failed`;
  `cancelled` after `cancelRun` (stays cancelled even if an in-flight job finishes);
  `stopped_cap` when the cap stops it. `finishedAt` is set on any final status.
- `cancelRun` marks queued jobs `cancelled` (they must not call the model) and keeps finished
  lessons.

## Worker (`worker.ts`)

```ts
registerGenerationWorker({ db, boss, llm, concurrency, maxAttempts?, prices?, pollingIntervalSeconds?, getEldInput? })
  -> { stop(): Promise<void> } // stops fetching and waits for in-flight jobs
```

Per job:

1. Skip if the job or run is cancelled/stopped, or the job is already `generated` (restart safety:
   a finished lesson is never regenerated).
2. Spend guard: a job only starts while `run.costUsd < run.capUsd`. Otherwise it is marked
   `cancelled` (not `generated`, not left `queued`) and the run becomes `stopped_cap`.
3. Mark job and lesson `generating`; build the prompt with the run's prompt version; call
   `llm.generateStructured({ model: run.model, system, prompt, schema: lessonBodyJsonSchema() })`.
4. Build front matter from the outline row (`number`, `arc`, `type`, `durationMinutes = 50 x days`,
   focus/supporting/ELD codes from `lesson_standards`), merge with the body, and
   `validateLesson(content, { focusStandards, days })`.
5. Invalid output or a thrown call is retried up to `maxAttempts` in total; the retry prompt
   includes every `error.message` from `validateLesson`. After the last attempt the job is
   `failed` with the error text and the lesson status is `failed` with `content` left null.
   Invalid output is never saved.
6. On success: save `lessons.content`, status `draft`, insert a `lesson_versions` row
   (`author_id` null), and record model, prompt version, tokens and cost for the lesson.
7. Tokens and cost of **every** attempt are added to the job and to `run.costUsd`.

Concurrency: at most `concurrency` model calls at once per worker (`localConcurrency`).

## Progress (`progress.ts`, R9)

```ts
type LessonGenerationStatus = 'not_started' | 'queued' | 'generating' | 'generated' | 'failed' | 'cancelled'
getUnitProgress(db, unitId) -> {
  lessons: { lessonId; lessonNumber: number | null; isFlex: boolean; status: LessonGenerationStatus; error: string | null }[] // outline order
  counts: Record<LessonGenerationStatus, number> // every key present
  run: { id; status; statusLabel; costUsd; capUsd } | null // latest run
}
type LessonProgressEvent = { type: 'lesson'; unitId; lessonId; lessonNumber: number | null; status: LessonGenerationStatus }
subscribeToUnitProgress(db, unitId, listener) -> Promise<() => Promise<void>> // unsubscribe
```

A lesson's status is its latest job's status (`not_started` without a job). Events fire for
every change (including `queued` when a run starts) within 5 s; no events after unsubscribe.
LISTEN/NOTIFY or polling are both fine.

## SSE route

`GET /api/units/:id/generation/events` calls `requireRole(['author', 'reviewer', 'approver'])`,
answers 404 for an unknown unit, otherwise 200 `text/event-stream`. Every message is
`data: <json>\n\n`: first `{ type: 'snapshot', progress: getUnitProgress(...) }`, then one
`LessonProgressEvent` per change. The stream ends when the request is aborted.
