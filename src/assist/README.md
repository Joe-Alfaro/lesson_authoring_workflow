# AI assist and the M4 editor UI (R20, R21, R22, R23 workflow UI, R14 version changes)

The tests below were written first (red) and define this contract. Names, file paths, return
shapes, table columns, messages and accessible names are what the tests use; anything not listed
is up to the implementation. **No test calls a real model**: services take an `LlmClient` (the
fake in `tests/fake_llm.ts`), routes get theirs from a mocked `src/assist/provider.ts`, and the
e2e app talks to a fake Anthropic API through the real adapter (below).

| Test file                                  | Kind        | Covers                                                                     |
| ------------------------------------------ | ----------- | -------------------------------------------------------------------------- |
| `src/assist/service.int.test.ts`           | integration | R20, R21, R22 services; roles; lock; retry; metering; global budget        |
| `src/app/api/assist.int.test.ts`           | integration | the three routes: status codes, bodies, R27 role checks, 402 budget        |
| `src/workflow/version_changes.test.ts`     | unit        | R14 `changedAreas`                                                         |
| `src/workflow/version_changes.int.test.ts` | integration | R14 `listVersions(...).changes`                                            |
| `src/workflow/versions.int.test.ts` (edit) | integration | `listVersions` items gain `changes`                                        |
| `src/workflow/history_text.test.ts`        | unit        | R23 timeline wording                                                       |
| `src/db/migrate.int.test.ts` (edit)        | integration | new table `assist_calls`                                                   |
| `tests/e2e/assist.spec.ts`                 | e2e         | R20 toolbar/pending/suggestion/accept/undo/collab, R21, R22, budget, roles |
| `tests/e2e/workflow.spec.ts`               | e2e         | R23 bar per status and role, request changes, live lock, history timeline  |
| `tests/e2e/version_changes.spec.ts`        | e2e         | R14 "what changed" in the list and highlighted differences in the preview  |

Fixtures: `tests/fixtures/lesson/rich_lesson_fixture.ts` (ids `sec-launch`, `sec-lab`,
`sec-action` with parts `part-a`/`part-b` labelled A/B, `sec-lookback`, blocks `b-say`,
`b-pulse`, ...; focus standards RL.6.1, RL.6.2), `tests/workflow_fixtures.ts`, and the real grade 6
standards in `data/standards/`.

## Service (`src/assist/service.ts`)

```ts
type AssistDeps = {
  db: Database
  llm: LlmClient
  model?: string        // default getAssistModel(): ASSIST_MODEL, else DEFAULT_MODEL (Haiku-class)
  prices?: PriceTable   // default MODEL_PRICES
  globalCapUsd?: number // default getGlobalSpendCapUsd() (SPEND_CAP_USD, default 20)
}
type AssistActor = { id: string; role: Role }
type SelectionAction = 'rewrite' | 'shorten' | 'simplify' | 'instruction'

suggestSelection(deps, { lessonId, actor, action, text, instruction?, blockId? })
  -> { suggestion: string; costUsd: number }
regenerateSection(deps, { lessonId, actor, sectionId, instruction? })
  -> { section: Section; costUsd: number }
checkAlignment(deps, { lessonId, actor })
  -> { checkedAt: Date; standards: AlignmentItem[]; costUsd: number }

type AlignmentItem = {
  code: string
  text: string // full text from the `standards` table ('' when the code isn't in it)
  verdict: 'addressed' | 'partly_addressed' | 'missing'
  reason: string
  evidence: { id: string; label: string }[]
}
```

- **Nothing is written to the lesson.** No service changes `lessons.content`, `last_edited_by`,
  status or versions. The reviewer applies a suggestion or a section in the editor, as one Yjs
  transaction, so it syncs to other editors and is saved by the collab server like any edit.
- **Checks, in order, before any model call** (a refused call calls nothing and records nothing):
  lesson exists (unknown or malformed id: `LessonNotFoundError`); role is reviewer, approver or
  admin (authors: `WorkflowForbiddenError`); the lesson is editable (`approved`, `generating`:
  `LessonLockedError`, for admins too); input (`AssistInputError`: blank `text`, an unknown
  action, `instruction` action with a blank instruction; `SectionNotFoundError`: unknown
  `sectionId`); budget (`AssistBudgetError`, below). The workflow errors are the ones in
  `src/workflow/errors.ts`; the others are in `src/assist/errors.ts`.
- **Prompts.** `system` + `prompt` of the `LlmRequest` contain: the selected `text` (selection);
  the `instruction` when given; for `simplify`, the unit's grade as `grade 6`; for a section, its
  current content (e.g. the Look Back reflection prompt) and the instruction; for alignment, every
  focus standard's code and full text from the `standards` table and the lesson's text. `schema`
  is the JSON schema of the expected answer.
- **Answers** (`LlmResponse.output`): selection `{ text: string }` (trimmed; `**bold**`/`*italic*`
  allowed); section `{ section: Section }`; alignment `{ standards: { code, verdict, reason,
evidence: string[] }[] }` where evidence holds section, part or block ids of the lesson.
- **Invalid answers** (blank/missing text; a section that fails the `Section` schema; an
  alignment answer missing a focus standard or with an unknown verdict; an `LlmOutputError`) get
  one repair retry, so at most **2 calls**; then `AssistOutputError`. Every call is metered.
- **Section normalising (R21).** The returned section keeps the current section's `id`, `kind` and
  `minutes` whatever the model sent ("Minutes stay at 5"). Parts and blocks without an id, or
  with an id used elsewhere in the lesson or twice, get fresh unique ids. The result passes
  `Section`, and the lesson with that section swapped in passes `LessonContent`.
- **Alignment (R22).** One item per `frontMatter.focusStandards` code, in that order; codes the
  model adds that aren't focus standards are dropped. Evidence ids not in the lesson are dropped.
  Labels: a Learning in Action part is `Part <label>` (`Part A`); a section is its name
  (`Look Back`); a block is `<where>, <block label>` where `<where>` is `Part <label>` inside
  Learning in Action, else the section name, and the block label is the editor's gutter label
  (`Part A, Pulse check`). Results are not stored.

### Metering and the global budget

- New table **`assist_calls`**: `id` uuid pk, `lesson_id` uuid → lessons **ON DELETE SET NULL**,
  `user_id` uuid → users ON DELETE SET NULL, `kind` text (`rewrite` | `shorten` | `simplify` |
  `instruction` | `section` | `alignment`), `model` text, `tokens_in` int, `tokens_out` int,
  `cost_usd` numeric(12,6), `created_at` timestamptz default now(). One row per model call
  (retries included) with `computeCostUsd(model, usage, prices)`. Tests insert rows with only
  `lesson_id, kind, model, tokens_in, tokens_out, cost_usd`.
- `getTotalSpendUsd(db)` (`src/generation/service.ts`) becomes generation runs **plus**
  `assist_calls`, so generation's run-start and per-job checks count assist spend, and assist
  counts generation spend. Spend stays counted after its lesson is deleted.
- **Refused when the budget is used up**: `getTotalSpendUsd(db) >= globalCapUsd` throws
  `AssistBudgetError` with exactly
  `AI budget used up: $<spent, 2 dp> of the $<cap, 2 dp> spend cap is spent. Ask an admin to raise SPEND_CAP_USD.`

## Provider (`src/assist/provider.ts`)

```ts
getAssistProvider(): { llm: LlmClient; model: string }
```

The Anthropic adapter (`createAnthropicLlmClient`) with `ANTHROPIC_API_KEY` and the model from
`ASSIST_MODEL` (default `DEFAULT_MODEL`). Without a key it throws `AssistUnavailableError` (503).
The SDK reads `ANTHROPIC_BASE_URL`, which is how the e2e run reaches the fake API. A low thinking
effort suits these short answers; that choice is the implementation's.

## API routes

`requireRole(['reviewer', 'approver'])` first (authors 403, admins pass, no session 307), the
session user as actor, `getAssistProvider()` for the client. Errors answer JSON `{ error }`:
`LessonNotFoundError`/`SectionNotFoundError` 404, `WorkflowForbiddenError` 403,
`LessonLockedError` 409, `AssistInputError`/bad body 400, `AssistBudgetError` **402** (its
message), `AssistOutputError` 502, `AssistUnavailableError` 503. Dates are ISO strings.

| Route                                                | Method | Body                                       | Success                        |
| ---------------------------------------------------- | ------ | ------------------------------------------ | ------------------------------ |
| `src/app/api/lessons/[id]/assist/selection/route.ts` | POST   | `{ action, text, instruction?, blockId? }` | 200 `{ suggestion }`           |
| `src/app/api/lessons/[id]/assist/section/route.ts`   | POST   | `{ sectionId, instruction? }`              | 200 `{ section }`              |
| `src/app/api/lessons/[id]/assist/alignment/route.ts` | POST   | none                                       | 200 `{ checkedAt, standards }` |

## Workflow additions (`src/workflow/`)

```ts
// src/workflow/version_changes.ts
changedAreas(before: LessonContent, after: LessonContent): string[]
// src/workflow/history_text.ts
historyEventText({ fromStatus, toStatus }): string
```

- `changedAreas`: areas in lesson order, each once: `Front matter` (front matter or any body
  field other than sections and homework), then per section in order: Learning in Action is
  reported per part as `Part <label>` when only part contents changed, and as `Learning in Action`
  when the section's own fields (minutes, purpose, parts added/removed/reordered) changed; other
  sections by name (`Launch`, `Literacy Lab`, `Look Back`); then `Homework`. Identical: `[]`.
- `listVersions` items gain `changes: string[]`: `changedAreas(previous older version, this
version)`; `[]` for the oldest version and whenever either content isn't a valid
  `LessonContent`. The versions route returns it too.
- `historyEventText`: draft→in_review `submitted for review`; changes_requested→in_review
  `resubmitted for review`; in_review→changes_requested `requested changes`;
  in_review→approved `approved`; approved→in_review `reopened for edits`; any→generating
  `started generating`; generating→draft `generated as Draft`; generating→failed
  `generation failed`; anything else `moved to <STATUS_LABELS[to]>`.

## Editor UI (mockups `R20-*`, `R21-*`, `R22-alignment-check`, `R23-*`, `R14-version-history`)

AI assist is offered only to reviewers, approvers and admins on an editable lesson; on approved
or generating lessons and for authors there is no selection toolbar and no `Regenerate … with AI`
button.

**Selection (R20).** Selecting text in the document (mouse, or a keyboard selection then
`Alt+/`) shows a `toolbar` named `Selection actions` with buttons `Rewrite`, `Shorten`,
`Simplify for grade 6` (the unit's grade), `Ask AI...` (Comment is R26). `Alt+/` focuses
`Rewrite`; arrow keys move between the buttons. `Ask AI...` turns it into a `dialog` named
`Ask AI about the selection` with a text field labelled `Instruction for the AI` and `Run`.
While the model works, a `status` card (polite live region) shows the action name, "Writing a
suggestion. Nothing in the lesson changes until you accept it." and `Cancel` (cancel: the card
goes, the late answer is ignored). The suggestion shows inline: the selection in an element
labelled `Removed text`, the suggestion in one labelled `Suggested text`, neither in the shared
Yjs document (other editors and the server see nothing yet), plus a `dialog` named
`AI suggestion` with `Accept` (focused), `Reject`, `Try again` (asks again with the same action
and instruction) and "Enter to accept, Esc to reject. Accepting can be undone in one step."
Accept replaces the selection in one transaction (one `Mod-Z` reverts it), syncs to other
editors (within 2 s in the tests) and returns focus to the editor; Reject or Escape removes the
preview and changes nothing. Errors show in an `alert`; the budget refusal shows the
`AssistBudgetError` message.

**Regenerate a section (R21).** Each section heading has a button `Regenerate <Section> with AI`
opening a `dialog` named `Regenerate <Section>` with "Only this section is rewritten. The rest of
the lesson stays as it is, and you review the result before it replaces anything.", a field
labelled `Instruction` (optional, may stay empty), `Cancel` and `Regenerate section`. The
proposal replaces the section in place, locally only, with a `region` named `Proposed <Section>`
reading "Proposed <Section>. Highlighted blocks replace the current section when you accept.
Minutes stay at <n>." and buttons `Accept`, `Reject`, `Try again`, `Show current version`.
Accept swaps the section in one transaction (one undo step; other sections untouched; syncs);
Reject restores the view.

**Alignment (R22).** The lesson bar button `Alignment check` opens the side panel with tab
`Alignment` selected; its `tabpanel` (named `Alignment`) runs the check when opened, with heading
`Standards alignment`, a caption ending "The check suggests; it doesn't change the lesson.", a
`Check again` button and a list with one `listitem` per focus standard: code, full text, verdict
(`Addressed`, `Partly addressed`, `Missing`), the reason and evidence chips as `link`s named by
their label that jump to that part of the lesson.

**Workflow bar (R23).** The lesson bar shows the status pill (icon + `STATUS_LABELS` word) and,
by status and role: Draft/reviewer+ `Submit for review`; In review/reviewer the text `Waiting for
an approver`; In review/approver `Request changes` and `Approve lesson`; Changes
requested/reviewer+ `Resubmit for review`; Approved/approver `Reopen for edits`; Approved/others
`Locked. Ask an approver to reopen.`; Generating: "Opens for editing when generation finishes".
Authors get no review buttons. Buttons not allowed are not rendered. `Request changes` opens a
`dialog` named `Request changes to Lesson <n>` with "The lesson goes back to <assignee> as Changes
requested. Your note appears in its history.", a textarea labelled `Note for the reviewer`
(focused, required), `Cancel` and `Request changes`; submitting a blank note shows "Add a note so
the reviewer knows what to change." and sets `aria-invalid="true"` without calling the route.
**Live status:** when another user changes the status, every open editor of that lesson updates
its pill, buttons and lock within 5 s without a reload (approve locks it: lock `status` notice, no
textbox; reopen makes it editable again). The `lesson_status_changed` notification the collab
server already listens to is the natural source.

**History (R23-history).** Side panel tab `History` (`tabpanel` named `History`): heading
`Status history` and an ordered list, newest first, one `listitem` per event reading
`<actor name or System> <historyEventText>` then the time, with the note quoted.

**Versions (R14).** Each item in the Versions list reads `<author or System>. Edited <changes
joined with ", ">`; the oldest generated version reads `System. Generated`. In the read-only
preview the notice reads "Viewing the version from <when> by <name>. Read-only. Highlighted text
differs from the current lesson." and each text field that differs from the current lesson shows
the version's text in an element labelled `Text in this version` and the current text, struck
through, in one labelled `Current text` (one of each per changed field).

## E2E harness (in this commit)

- `tests/e2e/fake_anthropic.ts`: a fake Messages API (streaming and not) on `E2E_FAKE_LLM_PORT`
  (default `E2E_PORT + 2`). Specs queue answers (`output`, optional `delayMs`, `usage`) and read
  the requests it got through `tests/e2e/assist_support.ts` (`fakeLlm.respond/requests/reset`);
  an unscripted call gets a 400. Usage defaults to 1000 + 1000 tokens.
- `tests/e2e/server.ts` starts it and gives `next dev` `ANTHROPIC_API_KEY=e2e-fake-key`,
  `ANTHROPIC_BASE_URL=<fake>`, `SPEND_CAP_USD=20`; the developer's key is never passed.
- Specs reset the database through the `db` fixture, which truncates `units` with CASCADE and so
  empties `assist_calls` (it references `lessons`).
- Screenshots (`test-results/screens/`): `R20-ai-toolbar`, `R20-ai-pending`, `R20-ai-suggestion`,
  `R20-ai-instruction`, `R21-regenerate-section`, `R21-section-preview`, `R22-alignment-check`,
  `R23-workflow-states-<status>-<role>`, `R23-request-changes`, `R23-approved-locked-live`,
  `R23-history`, `R14-version-history-changes`, `R14-version-diff`.

## Implementation notes (M4, D-047)

- Live status reaches open editors through `GET /api/lessons/[id]/events` (SSE, `{ type: 'status',
status }` on each `lesson_status_changed` for that lesson); the collab server still enforces the
  lock itself.
- Editor previews are decorations in `src/ui/editor/assist_plugin.ts`; the toolbar, cards and the
  section proposal are in `src/ui/editor/assist_layer.tsx`; the version diff is
  `src/ui/editor/version_diff.ts`.
- Shift+Home / Shift+End select to the start / end of the current field (keyboard selection
  before `Alt+/`).
