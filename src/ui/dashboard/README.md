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
