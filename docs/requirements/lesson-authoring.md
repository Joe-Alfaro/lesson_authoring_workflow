# Requirements: lesson authoring workflow

Status: **approved by the owner** (2026-10-25).

## Goal

An internal tool for a curriculum team. Content experts import a unit outline (a spreadsheet of
about 40 lessons), the system generates a standards-aligned, ~50-minute teacher lesson for each row
with an LLM in the background, and a staff of 20+ reviewers edits the lessons in a collaborative
WYSIWYG editor (ProseMirror + Yjs) with AI assistance and moves each one through review to
approved.

## Users and roles

| Role | Can |
| --- | --- |
| Author | Import outlines, edit the prompt, start, cancel and retry generation, regenerate lessons, edit lessons |
| Reviewer | Edit assigned or any lessons, use AI assist, comment, submit for approval |
| Approver | Everything a reviewer can, plus approve or send back lessons |
| Admin | Everything, plus manage users and roles |

Approved is the final state: it is how a lesson is "flagged as complete". Publishing into the
client's product is out of scope; export (R16) is the handoff.

## Inputs

- **Lesson outline** (`data/sample_unit/lesson_outline.csv`): row 1 is a banner (grade, unit,
  anchor text, ISBN), row 2 the header, then arc header rows, lesson rows, flex-day rows and a
  totals row. 16 columns: Filename, Lesson (arc), Lesson #, Type of Lesson, Days, Text Dependent
  Question, Lesson Description, Text Set Choice, Homework, Focus Standards, Additional CA ELA
  Standards, CA Media Literacy Standards, Performance Task skill, Foundational Skills Focus,
  Vocabulary, Designated ELD Standards.
- **ELD scope and sequence** (`data/sample_unit/eld_scope_and_sequence.csv`), optional: per-lesson
  ELD standards, language and content objectives, ideas for Launch / Literacy Lab / Learning in
  Action / Look Back, and suggested routines. In the sample its content columns are empty, so ELD
  content is generated from the outline's Designated ELD Standards column and this file is an
  optional input (R5).
- **Standards reference data**: CA CCSS for ELA/Literacy and CA ELD standards (codes and full
  text), at least for grade 6.
- **Lesson format**: derived from example lessons on the review site linked in the brief. Its
  lesson pages are public. Up to about 10 pages covering different lesson types are read, read-only,
  to derive the schema and the prompt style guide; none of their text is copied into the repo.

## Lesson structure (target output)

Each generated lesson has:

1. Front matter: unit, lesson number, arc, title, duration (50 min), focus standards, supporting
   standards, ELD standards, lesson texts (title, source, pages).
2. Student learning objectives: content, language, foundational skills.
3. Essential question(s) and connections (knowledge-building, enduring understanding, future
   lessons, unit performance task).
4. Lesson pacing: Launch, Literacy Lab (core lessons), Learning in Action (one or more parts, each
   tagged with standards), Look Back, with minutes per section summing to the lesson duration, and
   the routines used. Typical splits: Spark 15/30/5; core lessons 5 Launch, 10 Literacy Lab, 30
   Learning in Action, 5 Look Back; flex days 5/40/5.
5. Lesson sequence, one block per section: teacher moves, "Say", "Say these directions", "Ask"
   prompts with exemplar student responses, teacher tips, a pulse check (multiple choice with
   rationales), integrated ELD instructions (purpose, sentence frames, watch-for/support,
   success criteria), additional student support (struggling / extension), reflection, and
   materials and target vocabulary where the lesson uses them.
6. Homework (when the outline gives one).

## Requirements

Priority: **must** (needed for a complete submission), **should** (expected, cut last),
**bonus** (only if time allows).

### A. Outline import

**R1. Import an outline from a link or a file** (must)
- A Google Sheets share link set to "anyone with the link" imports without any Google credentials.
- Uploading `lesson_outline.csv` imports the same result as the link.
- Tests read the sheet link from an environment variable (a placeholder sheet that holds the
  scrubbed sample); no client sheet link appears in tracked files. Unit tests stub the fetch.
- A link to a private or missing sheet shows an error that says the sheet must be shared by link,
  and creates no unit.

**R2. Parse the sample outline correctly** (must)
- Importing the sample produces one unit with grade 6, the anchor text title and ISBN from the
  banner, and exactly 41 lessons numbered 1-41.
- The 4 arcs (Spark, Investigation 1, Investigation 2, Showcase) are stored with their
  descriptions, and every lesson is linked to its arc.
- The 6 flex-day rows are stored as flex days, not lessons; arc header rows and the totals row
  create no lessons.
- Every lesson stores all 16 columns' values, with non-breaking spaces trimmed.

**R3. Normalize standards codes** (must)
- "RL.6.1, 6.2 L.6.4" yields RL.6.1, RL.6.2 and L.6.4.
- Duplicates are removed and the order is kept.
- "ELD.PI.6.6 – Exchange information..." yields the code ELD.PI.6.6.
- A code not found in the standards reference data is kept and shown as a warning on the import
  preview and on the lesson.

**R4. Preview and confirm before generating** (must)
- After parsing, a preview table lists every lesson (number, arc, type, title or description,
  focus standards) with warnings, before anything is generated.
- The author can cancel the import from the preview and no unit remains.

**R5. Optional ELD tab** (should)
- An ELD scope-and-sequence file or tab can be attached to the unit; rows are matched to lessons by
  lesson number within the arc and lesson type, and unmatched rows are listed as warnings.
- Non-empty ELD fields (language objective, content objective, ideas per section, routines) appear
  in that lesson's generation input. Empty fields are ignored.

### B. Generation

**R6. Generate a whole unit asynchronously** (must)
- Starting generation queues one job per numbered lesson (41 for the sample) and returns
  immediately; closing the browser does not stop it.
- Flex days are not generated by default; an author can generate a flex day on request.
- Jobs run in a separate worker process with a configurable concurrency limit.
- Restarting the worker mid-run resumes the remaining jobs; finished lessons are not regenerated.
- A failed lesson is retried up to a set number of times, then marked failed with the error, and the
  other lessons continue.

**R7. Standards-aligned, structured lessons** (must)
- Each generated lesson validates against the lesson schema (Lesson structure above); invalid model
  output is retried or the job fails, and is never saved as a lesson.
- The prompt for each lesson includes the full text of every focus and supporting standard listed
  for it, its outline row, its arc description, and the previous and next lesson descriptions.
- Every focus standard on the outline row appears in the lesson's front matter and is tagged on at
  least one Learning in Action part.
- Section minutes add up to the lesson's duration (50 minutes per day).
- Lessons cite the outline's texts by title and page range and do not reproduce copyrighted text
  beyond short quotations.
- Each lesson records the model, prompt version, token counts and estimated cost.

**R8. Lesson-type guidance** (should)
- Core Reading, Core Writing, Academic Discussion, Spark and Writing lessons each use type-specific
  instructions in the prompt (for example, Core Writing includes teacher modeling and a writing
  task; Academic Discussion includes a discussion protocol).

**R9. Live progress** (must; the brief lists it as a bonus)
- The unit page shows each lesson's status (queued, generating, generated, failed) and an overall
  count, and updates without a page reload within 5 seconds of a status change.
- A lesson's content can be opened as soon as that lesson finishes, while others are still running.

**R10. Edit the prompt** (must; the brief lists it as a bonus)
- An author can view and edit the unit's prompt template (system instructions, style guide and
  per-type guidance) before starting or before regenerating.
- Saving creates a new prompt version; earlier versions remain viewable and each lesson shows the
  version it was generated with.

**R11. Regenerate, cancel and retry** (should)
- An author can regenerate one lesson, a selection of lessons or all failed lessons with the
  current prompt version.
- Regenerating a lesson that has human edits asks for confirmation and keeps the previous version.
- An author can cancel a running unit; queued jobs stop and finished lessons are kept.

**R12. Spend guard** (must)
- Before starting, the UI shows the estimated cost of the run.
- The running cost of every run is stored and shown on the unit page.
- When a configurable cap is reached, no new jobs start and the unit shows "stopped: spend cap
  reached".
- The model is configurable per run; the default for development is a low-cost (Haiku-class)
  model.

**R13. Watch a lesson being written** (bonus)
- Opening a lesson that is generating shows its sections appearing as they stream.

### C. Persistence and data model

**R14. Persist units, lessons and history** (must)
- Units, arcs, lessons, lesson content, standards, prompt versions, generation jobs, workflow
  status and events survive a restart of every service.
- Every content save of a lesson creates a version with author and timestamp; a reviewer can view
  an earlier version and restore it.

**R15. Standards reference data** (must)
- Grade 6 CA CCSS ELA/Literacy and grade 6 CA ELD standards are loaded by a seed script with code,
  strand, grade and full text; every code used in the sample outline resolves except those R3
  flags.
- Hovering or clicking a standard code in a lesson shows its full text.

**R16. Export** (should)
- An approved lesson, or a whole unit, can be downloaded as structured JSON matching the lesson
  schema, and as HTML.

### D. Editor and collaboration

**R17. WYSIWYG lesson editor** (must)
- The editor is built on ProseMirror (via Tiptap) with a lesson schema whose nodes match the lesson
  structure (front matter, objectives, pacing, sections, Say / Ask / exemplar response, teacher
  tip, pulse check, ELD instructions, student support, homework).
- A reviewer can edit text, add and remove list items, parts and prompts, and the result still
  validates against the lesson schema.
- Front-matter standards are chosen from the standards reference data, not typed freely.

**R18. Real-time collaboration with Yjs** (must)
- Two users editing the same lesson in two browsers see each other's changes within 1 second and
  see each other's cursors and names.
- Concurrent edits to the same paragraph merge without losing either user's text.
- Closing all editors and reopening shows the latest content (the Yjs document is persisted).

**R19. Lesson view** (should)
- A read-only view renders the lesson in a teacher-facing layout close to the example lessons
  (front matter, pacing table, numbered sequence).

### E. AI assist

**R20. AI actions on a selection** (must)
- With text selected, a reviewer can run at least: rewrite, shorten, simplify for grade level, and
  a free-form instruction.
- The suggestion appears as a preview the reviewer accepts or rejects; nothing changes until they
  accept, and accepting is one undoable step.

**R21. Regenerate one section** (should)
- A reviewer can regenerate one section (for example Look Back) with an optional instruction; the
  rest of the lesson is untouched and the result goes through the same accept/reject preview.

**R22. Standards alignment check** (should)
- A reviewer can run a check that lists each focus standard with how the lesson addresses it, or
  that it is missing, using the standard's full text.

### F. Review and approval workflow

**R23. Lesson statuses and transitions** (must)
- A lesson moves through: Generating → Draft → In review → Changes requested → Approved, plus
  Failed.
- Only approvers can approve or request changes; requesting changes requires a note.
- Editing an approved lesson is blocked unless an approver reopens it, which returns it to In
  review.
- Every transition records who, when and the note, and the lesson shows this history.

**R24. Unit review dashboard** (must)
- The unit page lists lessons with status, assignee, last editor and last updated time, filterable
  by status, arc and assignee.
- It shows counts per status and marks the unit complete when every lesson is Approved.

**R25. Assignment** (should)
- An author or approver can assign lessons to reviewers, singly or in bulk; a reviewer sees "My
  lessons" with their assigned lessons.

**R26. Comments** (bonus)
- Reviewers can leave a comment on a lesson or on a selected passage, and resolve it.

### G. Auth and roles

**R27. Sign-in and role checks** (must)
- Unauthenticated users are redirected to sign-in for every page, API route and the collaboration
  server.
- Each action in the roles table is enforced on the server; a reviewer calling the approve endpoint
  gets 403.
- A seed creates at least 1 admin, 2 authors, 2 approvers and 20 reviewers with known demo
  passwords, documented in the README for local use only.
- Sign-in is email and password against seeded accounts; no SSO and no email delivery.

### H. Performance

**R28. 20+ concurrent reviewers** (must)
- A load script simulating 25 reviewers opening and editing different lessons, plus 2 pairs
  co-editing the same lessons, runs for 5 minutes with no errors and no lost edits.
- Under that load, the unit dashboard and a lesson open in under 1 second (p95) locally.
- If time runs short, the 5-minute soak and the co-editing pairs are cut first (shorter run,
  separate editors only); the 25-reviewer run itself is never cut, because it is the brief's
  performance benchmark.

**R29. Generation throughput** (should)
- A full 41-lesson unit finishes in under 30 minutes with the default concurrency, measured and
  reported in the docs (rate limits permitting).

### I. Running and deployment

**R30. One-command local setup** (must)
- From a clean clone, the README's steps (install, start Postgres, migrate, seed, run) start the
  web app, worker and collaboration server, and the sample unit can be imported and generated.
- Secrets come only from `.env`; `.env.example` lists every variable without values.

**R31. Hosted demo on Railway** (must)
- The web app, worker and collaboration server run as Railway services against a Railway Postgres,
  configured only through environment variables (`DATABASE_URL`, `PORT`, `ANTHROPIC_API_KEY` and
  the app's own settings).
- Each service has a build/start config (Dockerfile or Railpack), migrations run on deploy, a seed
  command exists, and each service exposes a health check that returns 200 when it can reach the
  database.
- The full flow (sign in, import, generate, edit together, approve) works at the public URL.
- The owner creates the Railway project, the database and the secrets; agents never do.
- On the hosted demo, seeded account passwords come from an environment variable, not the defaults
  documented in the public README, and the R12 spend cap is enforced, so a public URL can't run up
  LLM cost.

**R32. Quality gates** (must)
- Format, lint, type check, unit tests and the scrub check (R35) pass with one command; the
  outline parser (R2, R3) and workflow transitions (R23) have unit tests.

**R35. Scrub check** (must)
- A script reads banned terms, one per line, from the file named by `SCRUB_TERMS_FILE`, or from the
  project's private terms file when that variable is unset. The terms file is never tracked.
- It searches every git-tracked file, case-insensitively, and exits non-zero listing file and line
  for each match; with no matches it exits zero.
- If no terms file is found it fails with a message saying so, rather than passing silently.
- It runs as part of the R32 quality gate command.

### J. Documentation and demo

**R33. Technical documentation** (must)
- The repo has a README (what it is, setup, demo accounts, how to run a generation) and an
  architecture doc (services, data model, generation pipeline, collaboration, prompt design,
  standards grounding, tradeoffs and what we'd do next).
- (should) A short AI-usage note says which AI tools were used to build the project and how
  (coding agents, review, prompt design), and which parts were checked by hand.

**R34. Demo video** (must)
- A narrated video under 10 minutes shows: import of the sample, prompt edit, generation with live
  progress, a generated lesson, two-user co-editing, an AI assist action, and approval through to
  a complete unit.
- The repo, the docs and the video use neutral names for the client, its site and its products.

## Milestones (1-2 days)

| # | Milestone | Requirements | Exit check |
| --- | --- | --- | --- |
| M0 | Scaffold and data (≈2 h) | R14, R15, R27 (seed), R30, R32, R35 | App, worker and collab server start locally; DB migrated; standards and users seeded; scrub check in the gate |
| M1 | Import (≈2 h) | R1-R5 | Sample imports to 41 lessons with correct arcs, standards and warnings |
| M2 | Generation (≈4 h) | R6, R7, R9, R10, R12, R8 | A few lessons generated on a Haiku-class model with live progress; real per-lesson cost measured |
| M3 | Editor and collaboration (≈4 h) | R17, R18, R19 | Two browsers co-edit a generated lesson; reload keeps edits |
| M4 | Workflow and AI assist (≈3 h) | R20-R25 | A lesson goes Draft → Approved with history; AI rewrite accepted |
| M5 | Hardening and full run (≈2 h) | R11, R28, R29, R16 | One full 41-lesson run within its budget; load script passes |
| M6 | Deploy, docs and demo (≈3 h) | R31, R33, R34 | Deploy config handed to the owner; flow works at the public URL; README, architecture doc, video recorded |

Pairs for M1 and M2's schema work can run in parallel after M0; M3 depends on the lesson schema
from M2; M4 depends on M3.

**LLM budget.** The cap is $20: about $8 for development (Haiku-class model, a few lessons at a
time) and about $12 for one full-unit run on a Sonnet-class model in M5. After M2 measures the real
per-lesson cost, the plan is redone: if a full Sonnet-class run would exceed $12, the full run uses
the Haiku-class model and only a few showcase lessons use the Sonnet-class model.

## Out of scope

- Publishing into the client's product, a student-facing view, or other lesson types beyond the
  teacher lesson.
- Writing or reproducing the anchor texts and library articles.
- SSO, Google OAuth, writing back to the spreadsheet.
- Multi-program management beyond one program with several units.

## Resolved questions

| Question | Answer |
| --- | --- |
| Read more example lessons? | Yes: up to about 10 public lesson pages of different types, read-only, for the schema and style guide only; no copied text in the repo |
| ELD source? | Generated from the outline's Designated ELD Standards column; the ELD tab is optional (R5) |
| Roles and final state? | Author, reviewer, approver, admin; Approved is final; export (R16) is the handoff |
| Flex days? | Only the 41 numbered lessons are generated by default; flex days on request (R6) |
| Model and budget? | Haiku-class for development (~$8), ~$12 for one full Sonnet-class run, re-planned after M2 (Milestones) |
| Auth? | Seeded email/password demo accounts, local only (R27) |
| Hosted demo? | Yes, on Railway; must (R31) |
| Repo visibility? | Public; the scrub check (R35) runs before every push |
