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

## M2 follow-up contract (red tests: `post_process.test.ts`, `queue.int.test.ts`, `sample_unit.int.test.ts`, additions to `prompt_builder.test.ts`, `settings.test.ts`, `service.int.test.ts`)

New or changed exports:

| File                    | Export                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| `settings.ts`           | `getGenerationHeartbeatSeconds(env = process.env)`                                               |
| `queue.ts`              | `ensureGenerationQueue(boss, { heartbeatSeconds? } = {})`                                        |
| `worker.ts`             | `registerGenerationWorker({ ..., heartbeatSeconds? })` passes it to `ensureGenerationQueue`      |
| `prompt_builder.ts`     | `pulseCheckCorrectOption(lessonNumber: number \| null): 'A' \| 'B' \| 'C' \| 'D'`                |
| `post_process.ts` (new) | `normalizeLessonContent(content, { pulseCheckCorrectOption })`, `MAX_ADDRESSED_VOCABULARY` (= 6) |

### Queue: crash recovery (R6)

- `getGenerationHeartbeatSeconds(env)`: `GENERATION_HEARTBEAT_SECONDS`, an integer >= 10 (the
  pg-boss minimum); the default is at most 180 (suggested 60). Invalid values throw an error naming
  the variable.
- `ensureGenerationQueue(boss, { heartbeatSeconds })` (default `getGenerationHeartbeatSeconds()`)
  creates the queue with that `heartbeatSeconds` and a `retryLimit` >= 1, and **updates** an existing
  queue to it (`boss.updateQueue`), so a changed setting applies on the next worker start.
  `boss.getQueue(GENERATE_LESSON_QUEUE).heartbeatSeconds` reports it.
- A heartbeat rather than a short `expireInSeconds`: a live Core Writing call took 126 s on Haiku
  and will take longer on Sonnet, so a 3-minute expiry would retry live jobs and pay twice. With a
  heartbeat, pg-boss refreshes live jobs on its own (`heartbeatSeconds / 2`) and the supervisor
  fails and retries the job of a dead worker after one window.
- A retried job finds its `generation_jobs` row still `generating` and generates it (a `generated`
  job is still never redone).
- pg-boss only fails lost-heartbeat jobs on its monitor pass (`monitorIntervalSeconds`, default
  60 s), so the worker also sweeps every max(5, heartbeat / 2) s (`failLostGenerationJobs` in
  `queue.ts`) and fails the queue job of a `generating` row whose heartbeat is past its window (D-040).

### Flex days without focus standards (R6, R7)

The sample's six flex rows list no standards. `LessonFrontMatter.focusStandards` may be empty when
`type` is `flex` (still min 1 otherwise), and the "every focus standard tagged" check is then
vacuous, so `generateFlexDay` on a sample flex row is valid on the first attempt.

### Focus and additional at once (R7)

A code listed as both focus and additional (lesson 6: `RL.6.1`) is a focus standard only:
`loadLessonPromptInput` returns it once with kind `focus`, `frontMatterFromOutline` leaves it out of
`supportingStandards`, and `buildLessonPrompt` lists it once (also when its input has the
duplicate).

### Front matter texts (R7, Lesson structure item 1)

`frontMatterFromOutline` fills `texts` from the outline:

- The anchor novel: `{ title: unit anchor text title, source: the author from the banner
("... by <author>"), kind: 'novel', pages }`, where `pages` is the first `pp. N–M` range in the
  lesson description, verbatim (lesson 6: `pp. 16–22`), and absent when there is none.
- One text per `•` bullet of Text Set Choice, kind `short_form`, without the bullet. A quoted title
  (`“...”` or `"..."`) is the `title`; text after `" in "` that follows it is the `source` (lesson 5:
  `The Hare and the Lion` from `Zanzibar Tales: ..., translated by George W. Bateman`). Without
  quotes the whole bullet is the title. Lines that are not bullets (a note to the writer) are not
  texts.

### Regenerate (R11)

- `regenerateLessons({ failed: true })` selects lessons whose **workflow status** is `failed`, even
  when their latest job was cancelled by a later run.
- With `confirmOverwrite`, the edited content is kept as a version only if the latest
  `lesson_versions` row isn't already that content: the editor's save (`saveLessonContent`) already
  created it, so a regenerate after a save leaves 3 versions (generated, edited, regenerated).

### Prompt tuning the code enforces (smoke run "Weaknesses to tune")

- **Pulse check position.** `pulseCheckCorrectOption(n)` gives each lesson a target letter
  (suggested `'ABCD'[(n - 1) % 4]`; any fixed letter for `null`), so lessons 1-4 get four different
  letters. `buildLessonPrompt` has a line naming the pulse check and `option <letter>`. After
  validation the worker runs `normalizeLessonContent`, which moves each pulse check's correct
  option to that position (the wrong options keep their order; rationales stay with their option).
- **Part labels.** Learning in Action labels `A`, `a`, `Part a`, `Part A:` become `Part A` (etc.);
  unlabeled Learning in Action parts get `Part A`, `Part B`, ... by position; other labels (flex
  `Huddle N`) and other sections are unchanged. The default template says `"Part A"`, `"Part B"`.
- **Addressed vocabulary.** `normalizeLessonContent` keeps an addressed entry only when its term
  occurs in the lesson body outside `vocabulary` (case-insensitive, at a word start, so `cite`
  matches `citing`), then keeps the first `MAX_ADDRESSED_VOCABULARY` (6, the outline's own cap).
  The default template says the same in its vocabulary line ("at most 6", words the lesson uses).
- **Essential questions.** The default template tells the model the essential questions come from
  the outline's text-dependent question (the column is "Text Dependent Question tied to the EQ")
  where present, and asks for at most 2 (one line that names both).
- **Exemplar length.** The template keeps "1-2 sentences for quick checks" (a regression guard).
- `normalizeLessonContent` is pure (does not mutate its input) and its result still validates.

## M5 robustness contract (red tests: `robustness.int.test.ts`, `post_process_polish.test.ts`, additions to `prompt_builder.test.ts`, `src/ui/dashboard/dialogs.test.tsx`, `tests/e2e/dashboard_generation.spec.ts`)

D-045 and its addendum. No test calls a real model: the malformed-JSON test drives the real
Anthropic adapter against `tests/e2e/fake_anthropic.ts` (`ANTHROPIC_BASE_URL`), whose scripted
responses now take raw `text` as well as `output`.

### Crash retries run out (R6, D-045 (1))

When pg-boss has no retry left for a job whose worker died (the queue job is `failed`, the
`generation_jobs` row still `generating`), the worker marks the row `failed` with a non-empty
error, moves the lesson through `applySystemTransition` (Failed without content, a workflow event
from Generating; Draft with a note when it has content, as for other failures), sends the progress
event and finishes the run (`completed`, `finishedAt` set). Detection is the worker's
lost-heartbeat sweep: after failing lost jobs it asks `findExhaustedGenerationJobs` for
`generating` rows whose queue job is `failed` with no live (`created`, `retry`, `active`) try; a
row whose queue job is waiting for a retry is left alone.

A crash retry that may not run (red tests: `robustness_settle.int.test.ts`) is settled the same
way: when the retry finds its run no longer active (cancelled while the worker was dead) or a cap
reached, the row is `cancelled` with `reserved_usd` 0, and a lesson still Generating from the dead
try moves back through `applySystemTransition` (Failed without content, Draft when it has
content) with a note saying why.

### Attempts carry across crash retries (R6, D-045 (2))

`generation_jobs.attempts` counts model calls over every try of the queue job. A retried job
continues at `attempts + 1`, so a lesson gets at most `maxAttempts` calls in total. A job whose
row already has `attempts >= maxAttempts` fails without a model call (lesson Failed, run finishes).

### Caps count jobs in flight (R12, D-045 (3))

A job reserves one lesson estimate (the run's per-lesson estimate, as `estimateRunCost`;
`estimateLessonCostUsd`) when it starts and releases it when it finishes
(`generation_jobs.reserved_usd`, set and checked under one Postgres advisory lock, so two workers
can't both take the last room); the run and global (`SPEND_CAP_USD`) guards compare
spent + reserved with the cap, across every run and worker process (so the reservation lives in
the database). Only rows in `generating` count, so a reservation left on a finished row can't
block admission for good. Total spend can then exceed a cap by at most one lesson estimate, with any
concurrency. A job blocked only by other jobs' reservations waits for them rather than stopping
the run: the run is `stopped_cap` once its real spend reaches the cap, so a run whose estimate is
above what lessons really cost still spends up to its cap. A waiting job polls every second; when its worker stops, it hands
itself back to the queue unstarted.

### Prompt polish (R7, D-045 (4))

`post_process.ts` adds `MAX_TEACHER_TIPS` (= 2), `MAX_QUICK_CHECK_EXEMPLAR_SENTENCES` (= 2) and
`polishHints(content): string[]`.

- **Teacher tips:** `normalizeLessonContent` keeps the first two `teacher_tip` blocks in lesson
  order (sections, parts, blocks) and drops the rest. An extra tip that is the only block of its
  part becomes a `paragraph` with the same text instead, so the part keeps a block (and its label,
  standards and minutes) and the lesson still has at most two tips.
- **Quick-check exemplars:** every `ask` is a quick check except those in Learning in Action of an
  `academic_discussion` lesson (discussion questions take 2-4 sentence exemplars; writing models
  are `display` blocks). `normalizeLessonContent` trims a quick-check exemplar to its first two
  sentences. A sentence ends at `.`, `!` or `?` (and a closing quote or bracket right after it)
  followed by whitespace and an uppercase letter or an opening quote, so `p. 4` and `pp. 16–22`
  are not sentence ends.
- **Pulse check length (hint-only, PM on D-055 (4)):** the code can't rewrite option text, so the
  default template has a line saying the correct option must not be the longest, and
  `polishHints` returns a review hint (naming the pulse check and "longest") when the correct
  option is strictly the longest one in every pulse check of the lesson (a tie, or one check where
  it isn't, gives no hint). The worker saves the lesson as usual and stores the hints in
  `lessons.polish_warnings` (empty when there are none), and the lesson bar shows each as a small
  "Review hint". There is no repair retry for it: polish never costs a model call or fails a
  lesson.

### Malformed JSON (R7, Sonnet probe)

An answer that isn't valid JSON is an attempt like any other: the repair prompt says the answer
was not valid JSON, the retry's valid lesson is saved, and both calls' tokens and cost count on
the job, the run and `getLessonGeneration`. (Already true; the test is a regression guard.)

### Dashboard (D-045 addendum)

- An author's open dashboard picks up a cap raised by an admin elsewhere within 5 s (the cost
  panel's Spend cap and an enabled Resume generation), without a reload. Today the page re-reads
  only on lesson events or while a run is active.
- `CancelRunDialog` leaves zero counts out of its text (no "The 0 queued lessons won't start"); the
  non-zero facts and "You can generate the rest later." stay.

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
