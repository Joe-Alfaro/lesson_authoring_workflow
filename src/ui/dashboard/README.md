# Unit dashboard components (UI-B: R9-R12, R24, R25)

The component tests in this folder (`*.test.tsx`, Vitest + Testing Library in jsdom, run with
`npm run test:component`) and the e2e specs `tests/e2e/dashboard_generation.spec.ts`,
`dashboard_review.spec.ts` and `prompt_editor.spec.ts` were written first (red) and define this
contract. Copy is the approved mockups' (`docs/design/lesson-authoring/`), with real dollar values
(D-027). Anything not listed here is up to the implementation.

## Modules

| File                          | Export                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `format.ts`                   | `formatUsd(value: number): string`, `modelLabel(model: string): string`                                                              |
| `generation_summary.tsx`      | `GenerationSummary({ progress }: { progress: UnitProgress })` (`src/generation/progress.ts`)                                         |
| `status_chips.tsx`            | `StatusChips({ counts, pressed, onToggle })`                                                                                         |
| `start_generation_dialog.tsx` | `StartGenerationDialog({ lessonCount, modelLabel, promptVersion, promptHref, estimatedUsd, capUsd, concurrency, onStart, onClose })` |
| `cancel_run_dialog.tsx`       | `CancelRunDialog({ queued, generating, generated, onConfirm, onClose })`                                                             |
| `regenerate_dialog.tsx`       | `RegenerateDialog({ lessonNumbers, editedLessonNumbers, promptVersion, estimatedUsd, onConfirm, onClose })`                          |

- `formatUsd` shows dollars with two decimals (`$0.51`, `$5.00`, `$12.00`); `modelLabel` maps a
  model id to its class (`claude-haiku-5-5` -> `Haiku-class`, `claude-sonnet-5-5` ->
  `Sonnet-class`, `claude-opus-5-5` -> `Opus-class`) and returns an unknown id unchanged.
- `GenerationSummary` counts **numbered lessons only** (flex days are generated on demand, D-030),
  even though `progress.counts` includes flex days. With no run it is the region "Generation";
  while a run is queued or running it is the region "Generation progress" with
  `aria-live="polite"`; when the run stopped at its cap it is the status "Generation stopped".
- `StatusChips` is the group "Lessons per status": one toggle button per status with a non-zero
  count, in the order Draft, In review, Changes requested, Approved, Failed, named
  `"<Status>: <n> lessons, filter"` with `aria-pressed`.
- The dialogs are modal: focus starts on the safe button (Cancel or Keep running), Tab stays
  inside, and Escape calls `onClose`. Start generation is a `dialog`; Cancel run and Regenerate
  are `alertdialog`s.

The pages that use them (the unit page `src/app/(app)/units/[id]/page.tsx`, My lessons and the
prompt editor) are covered by the e2e specs; the names the mockups don't draw are listed at the
top of each spec.

## Live updates

The unit page is a server component (`src/units/dashboard_data.ts` reads everything it shows) with
one client component, `unit_dashboard.tsx`. `use_live_refresh.ts` listens to the generation feed
(`/api/units/:id/generation/events`) and calls `router.refresh()` after each lesson event (debounced
150 ms); while a run is queued or running it also re-reads every 4 s, so the run's own status and
cost show even when no lesson changes. No page reload, and one source of truth for every number.

## Routes (`src/generation_api/`, tests in `src/app/api/generation.int.test.ts`)

Each route calls `requireRole` first (admins always pass) and answers errors as JSON `{ error }`:
unknown unit, run or lesson 404; bad body, unknown model or invalid cap/template 400; global budget
exceeded, human edits or a run in the wrong state 409.

| Route                                         | Method | Roles  | Body / query                                        | Success                                           |
| --------------------------------------------- | ------ | ------ | --------------------------------------------------- | ------------------------------------------------- |
| `/api/units/[id]/generation/runs`             | POST   | author | `{ model?, lessonIds?, confirmOverwrite? }`         | 201 `{ runId, jobCount }`                         |
| `/api/units/[id]/generation/estimate`         | GET    | author | `?model=`                                           | 200 `{ lessonCount, estimatedUsd, perLessonUsd }` |
| `/api/units/[id]/generation/regenerate`       | POST   | author | `{ lessonIds? \| failed: true, confirmOverwrite? }` | 201; 409 `{ reason: 'human_edits', lessonIds }`   |
| `/api/generation/runs/[runId]/cancel`         | POST   | author |                                                     | 200 `{ status }`                                  |
| `/api/generation/runs/[runId]/cap`            | PUT    | admin  | `{ capUsd }`                                        | 200 `{ capUsd }`                                  |
| `/api/generation/runs/[runId]/resume`         | POST   | author |                                                     | 201 `{ runId, jobCount }` (a new run)             |
| `/api/lessons/[id]/generate`                  | POST   | author | `{ model? }` (flex days only)                       | 201 `{ runId, jobCount }`                         |
| `/api/units/[id]/prompt-versions`             | GET    | author |                                                     | 200 `{ versions }`                                |
| `/api/units/[id]/prompt-versions`             | POST   | author | `{ template }`                                      | 201 version                                       |
| `/api/units/[id]/prompt-versions/[versionId]` | GET    | author |                                                     | 200 version                                       |

Raising a cap (D-024 (1)) only works on a run stopped by it; the new cap must be above what the
run cost and at most the global `SPEND_CAP_USD` minus what every other run spent. Resume queues
the lessons the spend guard cancelled that still have no content, as a new run on the same model
whose cap is the raised cap minus the stopped run's cost; finished lessons are never generated
again.

Approvers see the bulk bar's Regenerate button disabled (the roles table gives regeneration to
authors). Export (R16, `src/export/README.md`): the row menu's Download JSON / HTML (disabled for rows
without content) and the unit-complete banner's Download unit JSON / HTML download from the export
routes, and so does the header Export menu (Download unit JSON / HTML).
