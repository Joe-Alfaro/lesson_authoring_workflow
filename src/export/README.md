# Export (M5: R16)

The tests below were written first (red) and define this contract. Names, paths and shapes are
what the tests import or read; anything not listed is up to the implementation.

| Test                              | Project     | Covers                                                        |
| --------------------------------- | ----------- | ------------------------------------------------------------- |
| `src/export/file_names.test.ts`   | unit        | safe download file names                                      |
| `src/export/render_html.test.tsx` | component   | standalone lesson and unit HTML (jsdom `DOMParser`)           |
| `src/app/api/export.int.test.ts`  | integration | the two routes: JSON shape, HTML, roles, 401/404/409, headers |
| `tests/e2e/export.spec.ts`        | e2e         | row menu and unit-complete downloads in the browser           |

## Decisions (non-approved lessons)

- **Lesson export works for any lesson with valid content**, approved or not. A non-approved
  lesson is marked: `lesson.approved: false` and its `status` in JSON, and a visible
  "Not approved" notice naming the status ("Not approved: In review") in HTML. An approved lesson
  says who approved it and when, and has no "Not approved" text. Reviewers download drafts to read
  offline; the marker keeps a draft from passing as the handoff.
- **A lesson without valid content** (never generated, failed, or content that no longer parses
  as `LessonContent`) answers 409 `{ error }`. The row menu's download items are disabled for
  rows without content, like Version history.
- **Unit export includes approved lessons only** (in outline order, flex days included when
  approved), with counts and the list of skipped lessons. It answers 200 even when nothing is
  approved yet (empty `lessons`); the HTML then says "0 of N lessons".

## Modules

| File                       | Exports                                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `src/export/types.ts`      | `EXPORT_VERSION` (= 1), `ExportedStandard`, `ExportedLesson`, `ExportedUnit`, `LessonExport`, `UnitExport` |
| `src/export/html.ts(x)`    | `renderLessonHtml(LessonExport): string`, `renderUnitHtml(UnitExport): string` (pure)                      |
| `src/export/file_names.ts` | `lessonFileName(input, ext)`, `unitFileName(input, ext)` (pure)                                            |
| `src/export/service.ts`    | building the exports from the database (not imported by the tests)                                         |

```ts
type ExportedStandard = {
  code: string
  framework: 'CCSS_ELA' | 'CA_ELD' | 'CA_SCHOOL_LIBRARY' | null // null: not in the reference data
  strand: string | null
  text: string | null // full text from the standards table, null when unknown (R3)
}
type ExportedLesson = {
  id: string
  unitId: string
  number: number | null
  isFlex: boolean
  position: number
  filename: string // the outline's Filename cell
  lessonType: string // the outline's Type of Lesson cell
  arc: { id: string; name: string; position: number } | null
  status: LessonStatus
  approved: boolean // approved === (status === 'approved')
  approval: { by: { id: string; name: string }; at: string } | null // latest approve event, ISO
  standards: ExportedStandard[] // every code lessonCodes(content) returns, once, in plain .sort() order
  content: LessonContent // as stored; every section, part and block has an id
}
type ExportedUnit = {
  id: string
  grade: number
  unitNumber: number
  anchorTextTitle: string
  isbn: string | null
  arcs: { id: string; name: string; position: number }[] // by position
}
type LessonExport = {
  exportVersion: 1
  exportedAt: string
  unit: ExportedUnit
  lesson: ExportedLesson
}
type UnitExport = {
  exportVersion: 1
  exportedAt: string
  unit: ExportedUnit
  lessons: ExportedLesson[] // approved lessons with valid content, by position
  skipped: { id: string; number: number | null; isFlex: boolean; status: LessonStatus }[] // the rest, by position
  counts: { total: number; exported: number; skipped: number } // total = every lesson row of the unit
}
```

- `content` is the stored `lessons.content` unchanged when it already has ids (the D-051
  backfill gives every lesson ids); a lesson still without ids gets them via `withContentIds`
  for the export, so `hasContentIds(content)` is always true.
- Dates are ISO strings. JSON is the `LessonExport` / `UnitExport` object itself, nothing around it.

## HTML (`renderLessonHtml`, `renderUnitHtml`)

One standalone file that opens offline and looks like the R19 lesson view (teacher-facing,
mockup `R19-lesson-view`):

- `<!doctype html>`, `<html lang="en">`, `<meta charset="utf-8">`, a `<title>`, and styles in one
  inline `<style>`. **No external assets and no scripts:** no `<script>`, `<link>`, `<img>`,
  `<iframe>`, `<object>`, `<embed>`, no `src` attribute, no `on*` attribute, no `@import` or
  `url(` in the styles.
- All lesson text is escaped (a `<script>` or `<img onerror>` typed into a lesson is text).
- **Front matter** as a `<dl>`: Focus standards, Supporting standards, ELD standards, Lesson
  texts (and the rest of the R19 front matter). Heading `<h1>` "Lesson 4: <title>".
- **Pacing table**: a `<table>` with a row per section: "Launch, 5 min" and so on.
- **Numbered sequence**: one `<h2>` per section, "1 Launch", "2 Literacy Lab", "3 Learning in
  Action", "4 Look Back" (text content, whitespace collapsed), then Homework when present.
- **Standards**: a section headed "Standards" lists each known code with its full text (the
  static file has no hover popover).
- **Approval**: approved: "Approved by <name> on Oct 25, 2026, 15:30 UTC"; not approved: "Not
  approved: <status label>" (`STATUS_LABELS`). The time is in UTC and labelled as such: a
  downloaded file has no viewer time zone, unlike the app, which shows times in the viewer's zone.
- **Long titles** wrap (`overflow-wrap: anywhere`) in the contents list and the headings.
- **Unit HTML**: one document. `<h1>` names the unit ("Unit 4: <anchor text>"); a
  `<nav aria-label="Contents">` has one link per exported lesson ("Lesson 4: <title>", "Flex
  day: <title>"), each `href="#<id>"` pointing at that lesson's `<article>`; every `id` in the
  document is unique (section anchors are per lesson); a line "<exported> of <total> lessons
  approved and included". No "Not approved" text (only approved lessons are in it).

## File names

`lessonFileName({ unitNumber, lessonNumber, position, title }, 'json' | 'html')` and
`unitFileName({ grade, unitNumber, anchorTextTitle }, 'json' | 'html')`:

- Lowercase ASCII `[a-z0-9-]`, then `.json` or `.html`; starts with a letter or digit; at most
  100 characters. Whatever the title holds (`../`, quotes, CR/LF, `<`, accents), nothing else
  survives.
- Lesson: `unit-<u>-lesson-<n>` then an optional `-<title slug>`; flex day:
  `unit-<u>-flex-day-<position>` then the optional slug (two flex days never collide).
- Unit: `grade-<g>-unit-<u>` then an optional `-<anchor slug>`.

## Routes

| Route                                      | Method | Query                             | requireApiRole                           | Success                    |
| ------------------------------------------ | ------ | --------------------------------- | ---------------------------------------- | -------------------------- |
| `src/app/api/lessons/[id]/export/route.ts` | GET    | `format=json` (default) \| `html` | author, reviewer, approver (admins pass) | 200 `LessonExport` or HTML |
| `src/app/api/units/[id]/export/route.ts`   | GET    | `format=json` (default) \| `html` | author, reviewer, approver (admins pass) | 200 `UnitExport` or HTML   |

- Any signed-in role downloads. No session: 401 JSON `{ error }` (route handler and proxy).
- Unknown or malformed id: 404 `{ error }`. Lesson without valid content: 409 `{ error }`.
  Another `format`: 400 `{ error }`.
- Headers: `content-type` `application/json; charset=utf-8` or `text/html; charset=utf-8`;
  `content-disposition: attachment; filename="<lessonFileName | unitFileName>"`;
  `cache-control: no-store`.

## UI

- Row menu (`R11-row-actions`): "Download JSON" and "Download HTML" are enabled for rows with
  content and download from the lesson route (the browser saves the route's file name).
- Unit-complete banner (`R24-dashboard-complete`): "Download unit JSON" and "Download unit HTML"
  are enabled and download from the unit route.
- Header "Export" (`tests/e2e/export_entry_points.spec.ts`): a menu with "Download unit JSON" and
  "Download unit HTML" from the unit route.
- Lesson view "HTML" button: downloads from the lesson route, so `src/export/html.ts` is the only
  HTML renderer.

## Implementation notes (from a throwaway prototype the tests were checked against)

- Every test here passed against a quick prototype (deleted again), so the contract can be met.
- **Next 16 rejects `react-dom/server` in the route-handler graph** ("You're importing a
  component that imports react-dom/server"; `react-dom/server.node` resolves to the
  react-server build without `renderToStaticMarkup`, and loading the renderer module with a
  dynamic `import()` did not help). In
  `next dev` the error shows as an overlay on every page, not only on the export routes. Reusing
  `LessonView` through `renderToStaticMarkup` works in Vitest but not in the app, so build the
  HTML another way (for example string templates over `src/lesson/labels.ts`) or find a
  supported server-render path in `node_modules/next/dist/docs/` first.
- `<a href="/api/.../export?format=..." download>` (or an anchor clicked from the menu action) is
  enough for the browser download; the route's `content-disposition` names the file.
