# Design spec: lesson authoring (all UI requirements)

Mockups for every UI requirement in [`docs/requirements/lesson-authoring.md`](../requirements/lesson-authoring.md),
drawn in one pass against [`STYLE.md`](STYLE.md). "Lesson Studio" is a placeholder product name.
Each mockup is an HTML file with a PNG beside it in [`lesson-authoring/`](lesson-authoring/); all
of them share [`lesson-authoring/studio.css`](lesson-authoring/studio.css), which holds the
`STYLE.md` tokens.

- **Widths.** Desktop at 1440 is the primary target. The unit dashboard and the lesson view are
  also drawn at 390 wide.
- **Data.** Lesson rows, arcs, types, page ranges and focus standards come from
  `data/sample_unit/lesson_outline.csv`, and standard texts come from `data/standards/`.
- **People.** People are the seeded demo accounts (Author 01, Approver 01, Reviewer 01-20).
- **Placeholders.** Money is shown as placeholders such as `{{EST_COST}}` because real costs come
  from M2.
- **Lesson body.** The Lesson 4 text in the editor mockups was written for the mockups to show the
  structure. It is not generated output, and it doesn't quote the novel.
- **Times and errors.** Timestamps and the failure message are illustrative.

## Requirement index

| Req | Mockups (`lesson-authoring/<name>.html` + `.png`) |
| --- | --- |
| R1 | `R1-units-empty`, `R1-import-empty`, `R1-import-error`, `R1-import-parsing` |
| R3 | `R4-import-preview` (normalized codes, unknown-code warning), `R15-standard-picker` (warning chip style) |
| R4 | `R4-import-preview` |
| R5 | `R1-import-empty` (attach ELD file), `R4-import-preview` (ELD summary and unmatched rows) |
| R6 | `R12-start-generation` (scope: 41 lessons, flex days excluded), `R9-dashboard-generating` |
| R9 | `R9-dashboard-generating` |
| R10 | `R10-prompt-editor`, `R10-prompt-version`; the prompt version shows in the lesson bar of every editor mockup |
| R11 | `R11-row-actions`, `R11-regenerate-confirm`, `R11-cancel-run`, retry in `R9-dashboard-generating` and `R23-workflow-states` |
| R12 | `R12-start-generation`, `R9-dashboard-generating` (running cost), `R12-dashboard-spend-cap` |
| R14 | `R14-version-history`, `R14-restore-confirm` |
| R15 | `R17-lesson-editor` (standard popover on RL.6.2), `R15-standard-picker` |
| R16 | `R24-dashboard-complete` (unit download), `R11-row-actions` (lesson download), `R19-lesson-view` (HTML) |
| R17 | `R17-lesson-editor`, `R15-standard-picker` |
| R18 | `R17-lesson-editor` (presence avatars, two remote cursors, one remote selection) |
| R19 | `R19-lesson-view`, `R19-lesson-view-mobile` |
| R20 | `R20-ai-toolbar`, `R20-ai-instruction`, `R20-ai-pending`, `R20-ai-suggestion` |
| R21 | `R21-regenerate-section`, `R21-section-preview` |
| R22 | `R22-alignment-check` |
| R23 | `R23-workflow-states`, `R23-request-changes`, `R23-history`, `R23-approved-locked` |
| R24 | `R24-dashboard-review`, `R24-dashboard-complete`, `R24-dashboard-mobile` |
| R25 | `R25-bulk-assign`, `R25-my-lessons` |
| R26 | `R26-comments` (low fidelity) |
| R27 | `R27-sign-in`, `R27-sign-in-error` |

Not drawn: R13 (bonus, watching a lesson stream in); see the open questions. R2, R7, R8 and R28-R35
have no UI of their own.

## Shared layout

- **Top bar** (56px): the product mark (a small pacing ribbon), the main nav (Units, My lessons,
  Prompts) and the signed-in user with a role chip.
- **Unit pages**: content is at most 1280px wide. The unit title sits above a summary panel, then
  the filters, then the lesson table grouped by arc.
- **Lesson pages**: a lesson bar sits under the top bar. It holds the back link, the lesson
  number, the status pill, the assignee, the prompt version and model, presence avatars, the save
  state, icon buttons for versions, comments and alignment, a link to the lesson view, and the
  workflow action for this status and role. Below it are three regions: the outline rail, the
  document, and the side panel when one is open.
- **Pacing colours** mark sections everywhere: the ribbon, the rail bars, the section heading
  rules, the gutter labels and the boxed-block rules. **Status pills** always pair an icon with a
  word.

## R27 Sign-in

**States.** The default form, and the error state after a failed attempt.

**Behaviour**
- Email and password only.
- A failed sign-in shows one alert above the form: "Email or password is incorrect." Neither field
  is marked, so the message doesn't reveal which field was wrong.
- Signed-out visits to any page redirect here and keep the `callbackUrl`.

**Accessibility**
- Both inputs have visible labels, `autocomplete="username"` and `"current-password"`.
- The error is `role="alert"`. On error, focus moves to the password field.
- Focus order: email, password, Sign in. Enter submits.

## R1, R3, R4, R5 Import

**Screens**

- **Units, empty.** Shows an invitation to import, with an "Import an outline" button.
- **Import form.** A segmented control switches between "Google Sheets link" and "Upload CSV".
  The link help text says the sheet must be shared as "Anyone with the link can view".
- **Optional ELD file.** A drop zone (CSV or link) explains how ELD rows match lessons.
- **Error.** "This sheet isn't shared by link, so it can't be read. In Google Sheets choose Share,
  set General access to 'Anyone with the link', then import again. No unit was created." The
  field gets the error border and `aria-invalid`.
- **Parsing.** Shows an indeterminate bar and a step list: fetched, reading rows, matching
  standards, matching ELD rows. Cancel stays available. Nothing is saved until the preview is
  confirmed.
- **Preview.**
  - The banner data: grade, unit, anchor text and ISBN.
  - Totals: 41 lessons, 4 arcs, 6 flex days that won't be generated, and 1 standards warning.
  - An ELD notice. With the sample file it reads: "45 rows, every content column is empty",
    followed by the unmatched rows.
  - A table of every lesson, grouped by arc, with #, type, title (with the page range when the
    description has one), focus standards as chips, and warnings.
  - Unknown codes (RL.6.9.a on lesson 22) show a warning chip and a highlighted row: "RL.6.9.a
    isn't in the standards reference data. Kept as written; check the code."
  - Codes that were normalized show their source text, for example lesson 4: Read from
    "RL.6.1, 6.2 L.6.4".
  - Flex days appear as muted rows after their arc.
  - A sticky footer holds "Cancel import" (discards everything) and "Create unit with 41 lessons".

**Accessibility**
- The segmented control is a `tablist`.
- Warnings use an icon plus text, never colour alone.
- The preview table has real `<th>` headers. Arc rows are group headers.
- Focus lands on the page title after parsing.

## R6, R9, R11, R12, R24, R25 Unit dashboard

**One page, four phases**

- **Before generation** (`R12-start-generation`).
  - The summary shows "0 of 41 generated" and every tile is Not generated.
  - "Generate lessons..." opens a dialog with:
    - the scope: all 41 numbered lessons or selected ones, plus "Flex days aren't included";
    - the model, with Haiku-class as the default;
    - the prompt version, with a link to view it;
    - the estimated cost and the spend cap;
    - a "Start generation" button.
- **Generating** (`R9-dashboard-generating`).
  - The summary shows "15 of 41 generated" and a Running pill. Below it: "4 generating, 20
    queued, 2 failed", and a note that the page can be closed.
  - The **unit strip** has one numbered tile per lesson, grouped by arc and coloured by status. A
    tile that just finished gets a ring.
  - The right column shows running cost, run estimate, spend cap, model, prompt version, start time
    and "Retry 2 failed".
  - Rows update live within 5 seconds (R9).
  - Generated lessons open straight away. The title is the link.
  - Failed rows show the last error and a Retry button. Cancel run sits in the page header.
- **Stopped by the spend cap** (`R12-dashboard-spend-cap`).
  - The red summary reads "Stopped: spend cap reached" and explains: generated count, not
    generated count, failed count, finished lessons kept.
  - Rows that never started say "Not started: the spend cap stopped the run."
  - "Resume generation" is disabled until the cap is raised (open question 1).
- **Review** (`R24-dashboard-review`, `R24-dashboard-complete`).
  - The summary shows "5 of 41 approved", a status count bar and the strip.
  - Each count chip is also a toggle that filters the table by that status.
  - Filters: search, Status, Arc, Assignee, and "Clear filters" when any is set.
  - Columns: select, #, lesson, type, status, assignee, last edited by, updated, row action, more
    menu.
  - When every lesson is approved, a green banner reads "Unit complete: all 41 lessons approved",
    with unit JSON and HTML downloads (R16).

**Actions**
- **Row menu** (`R11-row-actions`): Open in editor, Open lesson view, Assign..., Version history,
  Regenerate with prompt v4..., and the JSON and HTML downloads.
- **Bulk actions** (`R25-bulk-assign`): selecting rows replaces the filter row with a dark
  selection bar ("6 lessons selected": Assign, Regenerate, Clear). Assign opens a searchable
  reviewer list that shows each reviewer's current load, with the note "Assigning replaces the
  current assignee on all 6 lessons."
- **Regenerate confirmation** (`R11-regenerate-confirm`): names the lessons with human edits and
  says their content is saved as a version first. It also shows the cost estimate and that
  assignments are kept.
- **Cancel run** (`R11-cancel-run`): "The 20 queued lessons won't start, and the 4 lessons being
  generated stop. The 15 generated lessons are kept." The buttons are "Keep running" and a filled
  danger "Cancel run".
- **My lessons** (`R25-my-lessons`): a reviewer's assigned lessons, grouped by unit, with status
  counts.

**Narrow width** (`R24-dashboard-mobile`)
- The table becomes stacked rows: number, title, type, then status, assignee and updated.
- The strip wraps by arc. Filters collapse into one Filters button next to search.

**Accessibility**
- The summary region is `aria-live="polite"`. It announces count changes, not every tile.
- Each tile has an `aria-label` such as "Lesson 17, Draft".
- Count chips are buttons with `aria-pressed`.
- Checkboxes are labelled "Select lesson N". The row menu button is "More actions for lesson N"
  and uses `aria-haspopup="menu"`.
- Dialogs trap focus. Focus starts on the safe button (Cancel or Keep running), Escape closes,
  and focus returns to the trigger.
- Focus order: header actions, summary, filters, selection bar, table.

## R10 Prompt editor

**Layout and behaviour**
- Three columns: a version list, the editable template, and a read-only list of what is added to
  every lesson automatically (outline row, full standard texts, ELD fields, arc description,
  previous and next lessons).
- The template has three parts: system instructions, the style guide, and lesson-type guidance in
  tabs (Spark, Core Reading, Core Writing, Academic Discussion, Writing, Flex day). An edited tab
  shows a dot. Unsaved changes are highlighted.
- "Save as v4" creates a new version. "Discard changes" reverts.
- Each version lists who saved it, when, and how many lessons use it.
- Viewing an older version (`R10-prompt-version`) makes everything read-only. A banner names the
  lessons generated with that version.
- Every lesson bar shows "Prompt v3, Haiku-class" (R10's "each lesson shows the version").

**Accessibility**
- Editable areas are `role="textbox"` with `aria-multiline` and are labelled by their headings.
- The version list is a nav with `aria-current` on the open version.
- A Save or Discard prompt appears when leaving the page with unsaved changes.

## R17, R18, R15, R19 Lesson editor and lesson view

**Editor structure** (`R17-lesson-editor`, full length)

- **Front matter**
  - Unit, title, arc, type and duration.
  - Focus, supporting and ELD standards as chips, each group with "+ Add".
  - Lesson texts, vocabulary (taught words, plus words for additional support), and materials.
- **Objectives**: Content, Language and Foundational skills.
- **Essential questions** and **connections**.
- **Pacing**: a ribbon and a table built from the section minutes ("Built from the section minutes
  below. Total 50 of 50 minutes."). It isn't edited directly.
- **Sections**: 1 Launch, 2 Literacy Lab, 3 Learning in Action (Part A and Part B, each with its
  standards and minutes), 4 Look Back, and Homework (unnumbered, outside the 50 minutes).
- **Typed blocks**: a left gutter labels each one (Teacher, Say, Directions, Ask, Exemplar,
  Display). Routine names are small headings.
  - Exemplars are italic, indented, and tied to the Ask above them.
- **Boxed blocks**: Teacher tip, Pulse check, Reflection, Integrated ELD instructions and
  Additional student support.
  - The Pulse check has options A-D, the correct one marked, each with a Correct or Incorrect
    rationale.
  - ELD instructions have three parts: Purpose with language-focus chips, Say and ask, and Watch
    for and support if needed.
  - Student support is a Situation / Try this table.
- **Adding content**: "Add a block" with a menu of the block types (R17: add and remove prompts,
  list items, parts), and "Add a part" in Learning in Action. Regenerate (R21) sits on each section
  heading.

**Standards (R15)**
- Hovering or focusing a chip opens a popover with the code, strand and full text.
- Adding a standard (`R15-standard-picker`) uses a combobox over the grade 6 reference data only:
  code, strand and the start of the text. Free text can't be added (R17).
- Unknown codes carried over from import show the warning chip.

**Collaboration (R18)**
- Presence avatars (Reviewer 07, Approver 01) appear in the lesson bar.
- Each remote cursor shows a name tag in that user's collaborator colour. A remote selection is
  tinted at 20%.
- The save state reads "All changes saved".
- Collaborator colours are separate from section and status colours.

**Lesson view (R19)**
- A read-only, teacher-facing layout of the same content. Labels sit inline the way a printed
  guide reads ("Say:", "Ask:", "Exemplar response"). ELD and support boxes are expanded.
- The bar offers an HTML download and "Open editor".
- At 390 wide the front matter stacks, and a sticky chip row jumps between sections.

**Accessibility**
- The outline rail is a nav of in-page links.
- Block labels are visible text, not colour. Small coloured labels use the `-ink` tokens
  (≥ 4.5:1).
- Chips are buttons with `aria-describedby` pointing at the popover. The popover opens on hover
  and on focus, and closes with Escape.
- Collapsible boxes are buttons with `aria-expanded`.
- Remote cursors are `aria-hidden`. A polite live region announces "Reviewer 07 joined" or "left".
- Focus order: lesson bar, rail, document, side panel.

## R20, R21, R22 AI assist

**Selection actions (R20)**
- Selecting text shows a floating toolbar (`R20-ai-toolbar`): Rewrite, Shorten, Simplify for
  grade 6, Ask AI..., then Comment.
- Ask AI... turns the toolbar into an instruction field with Run (`R20-ai-instruction`).
- While it works, a status card shows an indeterminate bar, "Nothing in the lesson changes until
  you accept it" and Cancel (`R20-ai-pending`).
- The suggestion shows inline as a diff: removed text struck through in red, suggested text
  underlined in green (`R20-ai-suggestion`). A card offers Accept, Reject and Try again. Enter
  accepts and Escape rejects.
- Accepting applies one transaction, so one undo reverts it. The inserted text fades its highlight
  (see Motion in `STYLE.md`).

**Regenerate a section (R21)**
- Regenerate on a section heading opens a dialog (`R21-regenerate-section`) with an optional
  instruction. It explains that only this section changes and that the result is reviewed first.
- The proposal replaces the section in place (`R21-section-preview`), with highlighted blocks and
  a notice offering Accept, Reject, Try again and Show current version. Minutes are unchanged.

**Alignment check (R22)**
- Side panel, Alignment tab (`R22-alignment-check`). Each focus standard shows its full text and a
  verdict: Addressed, Partly addressed or Missing.
- Each verdict has a one-line reason and chips that jump to the parts of the lesson that address
  it.
- "Check again" re-runs the check. The panel says the check suggests and doesn't edit.

**Accessibility**
- The toolbar is `role="toolbar"` with arrow-key movement. It opens with Alt+/ when text is
  selected, as well as on mouse selection.
- The diff spans carry `aria-label`s ("Removed text", "Suggested text").
- The pending card is a polite live region. When the suggestion arrives, focus moves to Accept.

## R23, R14, R26 Workflow, history, versions, comments

**Status bar by status and role** (`R23-workflow-states`)

| Status | Role | What the bar offers |
| --- | --- | --- |
| Generating | anyone | Read-only, with a note that the lesson opens when generation finishes |
| Draft | reviewer | Submit for review |
| In review | reviewer | "Waiting for an approver" |
| In review | approver | Request changes, Approve lesson |
| Changes requested | reviewer | Resubmit for review |
| Approved | approver | Reopen for edits |
| Approved | reviewer | "Locked. Ask an approver to reopen." |
| Failed | author | Retry generation |

**Request changes** (`R23-request-changes`)
- The note is required. Submitting empty shows "Add a note so the reviewer knows what to change."
  and sets `aria-invalid`.

**Approved and locked** (`R23-approved-locked`)
- A banner explains the lock and who approved it. The document is read-only and editing
  affordances are hidden. Reopening returns the lesson to In review.

**History** (`R23-history`)
- The side panel History tab is a timeline of who, what and when, with change-request notes
  quoted.

**Versions (R14)** (`R14-version-history`)
- The Versions tab lists saved versions (who, when, what changed). A version is saved after
  30 seconds of idle editing and before any regenerate or restore.
- Selecting a version shows it read-only, with differences highlighted, and offers "Restore this
  version" and "Back to current".
- Restore asks for confirmation (`R14-restore-confirm`). The current content is saved as a
  version first.

**Comments (R26, low fidelity)** (`R26-comments`)
- The comment box at the top is for the whole lesson. Comments on a passage quote it and highlight
  it in the document. Resolve sits on each comment, and resolved comments are dimmed.

**Accessibility**
- The side panel tabs are a `tablist`, and the timeline is an ordered list.
- Confirmation dialogs are `alertdialog`. Focus starts on Cancel.

## Open questions

1. **Spend cap owner.** Who raises the cap, and is it per run or global? The mockup says an admin
   raises it, then the author resumes. Is a settings screen needed, or is it an environment
   variable only (Resume would then stay disabled until a redeploy)?
2. **Cost estimate source.** Before any lesson exists, is the estimate per-lesson tokens × count
   from a configured constant, or from a calibration run? The dialog copy assumes "number of
   lessons times the expected cost of one lesson on this model".
3. **Concurrency.** R6 makes concurrency configurable. Is it shown or editable in the start
   dialog? Not drawn.
4. **Version cadence.** "Every content save creates a version" (R14) with Yjs autosave would
   create many versions. The mockup assumes a version after 30 seconds of idle editing, plus
   before regenerate or restore.
5. **Changes requested → In review.** Is the transition the reviewer's "Resubmit for review"
   (drawn), or does any edit move it back automatically?
6. **R13 streaming.** The bonus view of sections appearing as they stream is not drawn. If built,
   it would reuse the lesson view with pending sections as skeletons. Draw it?
7. **Lesson title.** Generated lessons have their own title ("Lesson 4: Meeting a narrator who
   doesn't feel normal"), while the dashboard shows the outline description's first line plus
   pages. Should the dashboard switch to the generated title once a lesson exists?
8. **Dark theme.** Not proposed for this build. Confirm that light only is fine.
