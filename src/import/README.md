# Outline import (M1: R1-R5)

The tests in this folder were written first (red) and define the contract below. Names, file
paths and return shapes are what the tests import; anything not listed is up to the implementation.

## Modules

| File                                        | Exports                                                                                                | Kind         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------ |
| `src/import/parse_outline.ts`               | `parseOutline(csv): ParsedOutline`, `OutlineParseError`, types below                                   | pure         |
| `src/import/normalize_standards.ts`         | `normalizeStandards(cell, { kind, grade, isKnown }): { codes, unknownCodes }`                          | pure         |
| `src/import/sheet_link.ts`                  | `toCsvExportUrl(link)`, `fetchSheetCsv(link, fetchImpl = fetch)`, `SheetLinkError`, `SheetAccessError` | pure + fetch |
| `src/import/parse_eld.ts`                   | `parseEldFile(csv): EldRow[]`, `matchEldRows(rows, items): { matches, warnings }`                      | pure         |
| `src/import/import_service.ts`              | `previewImport`, `confirmImport`, `cancelImport`, `getLessonWarnings`, `ImportNotFoundError`           | DB           |
| `src/import/eld_service.ts`                 | `attachEldFile(db, unitId, csv)`, `getLessonEldInput(db, lessonId)`, `getUnitEldWarnings(db, unitId)`  | DB           |
| `src/app/api/imports/route.ts`              | `POST` (JSON `{ url }` or multipart field `file`) -> 200 preview, 400 `{ error }`                      | route        |
| `src/app/api/imports/[id]/confirm/route.ts` | `POST` -> 201 `{ unitId }`, 404 when the import is unknown                                             | route        |
| `src/app/api/imports/[id]/route.ts`         | `DELETE` -> 204 (cancel)                                                                               | route        |
| `src/app/api/units/[id]/eld/route.ts`       | `POST` (multipart field `file`) -> 200 `{ matched, warnings }`                                         | route        |

Every route calls `requireRole(['author'])` from `src/auth/require_role.ts` first and passes the
user's id as `userId`. Errors from parsing or fetching (`OutlineParseError`, `SheetLinkError`,
`SheetAccessError`, missing input) answer 400 with `{ error: message }`.

## `parseOutline(csv)`

Pure; no DB. Throws `OutlineParseError` when the text has no outline header row (for example an
HTML page or an unrelated CSV).

```ts
type ParsedOutline = {
  unit: {
    grade: number
    unitNumber: number
    anchorTextTitle: string
    isbn: string | null
    banner: string
  }
  arcs: { name: string; description: string; position: number }[] // outline order
  items: ParsedItem[] // numbered lessons and flex days, outline order
  warnings: ImportWarning[]
}
type ParsedItem = {
  position: number // row order among items, ascending
  arcName: string // flex days belong to the arc whose "End of <arc> (Flex Days)" block they are in
  isFlex: boolean
  lessonNumber: number | null // from the "Lesson #" column ("Lesson 4" -> 4), null for flex days
  filename: string
  lessonType: string
  days: number
  textDependentQuestion: string
  description: string
  textSet: string
  homework: string
  focusStandards: string
  supportingStandards: string
  mediaLiteracyStandards: string
  performanceTaskSkill: string
  foundationalSkills: string
  vocabulary: string
  eldStandards: string
  rawRow: Record<string, string> // keyed by the 16 header cells exactly as in the sheet
}
type ImportWarning = { message: string; lessonNumber?: number | null; code?: string }
```

- Banner (row 1): `G6, U4: <title> by <author>\nISBN <isbn>` -> grade 6, unit 4, title, ISBN.
- Arc header rows (no filename, no lesson number, arc name in "Lesson") create arcs, not items.
  The arc description is the "Lesson Description" cell of that row.
- "End of ... (Flex Days)" rows and the totals row (only "Days" filled) create nothing.
- Rows with "Lesson" = `Flex` are flex days (`isFlex: true`).
- The lesson number comes from "Lesson #", never from the filename (the sample has typos such as
  `L309_...` for lesson 39). Filenames are kept as written.
- Every cell is trimmed, including non-breaking spaces (U+00A0), in the fields and in `rawRow`.
  A U+00A0 inside a cell becomes a normal space (D-028), in the outline and in ELD files.
  Field names match the `lessons` columns in `src/db/schema.ts`.

## `normalizeStandards(cell, { kind, grade, isKnown })`

`kind` is `'focus' | 'supporting' | 'media' | 'eld'` (the `lesson_standard_kind` enum);
`isKnown(code)` says whether the code is in the reference data.

- `RL.6.1, 6.2 L.6.4` -> `RL.6.1, RL.6.2, L.6.4` (a bare `N.N` reuses the previous strand).
- Ranges expand: `W.6.2.a–f` -> `W.6.2.a … W.6.2.f` (en dash or hyphen).
- Duplicates are removed, first occurrence order kept.
- ELD cells: `• ELD.PI.6.6 – Exchange information…` -> `ELD.PI.6.6`; the description is dropped.
- Media column: bare `2.1.a` -> `LIB.<grade>.2.1.a`.
- Unknown codes stay in `codes` and are also listed (deduplicated) in `unknownCodes`.

## Sheet links (`sheet_link.ts`)

- `toCsvExportUrl` turns any `https://docs.google.com/spreadsheets/d/<id>/...` link into
  `https://docs.google.com/spreadsheets/d/<id>/export?format=csv`, adding `&gid=<gid>` when the
  link names a tab (`#gid=` or `?gid=`). Account-switch links (`/spreadsheets/u/<n>/d/<id>/...`)
  convert the same way (D-028). "Publish to the web" links (`/spreadsheets/d/e/<id>/pub...` or
  `/pubhtml...`, also under `/u/<n>/`) become `https://docs.google.com/spreadsheets/d/e/<id>/pub?output=csv`,
  plus `&gid=<gid>&single=true` when the link names a tab. Anything else throws `SheetLinkError`.
- `fetchSheetCsv` fetches the export URL with `fetchImpl` (no Google credentials). A non-2xx
  response or an HTML body (Google's sign-in page for a private sheet) throws `SheetAccessError`
  whose message says the sheet must be shared by link ("anyone with the link").
- Unit tests stub `fetchImpl`. `sheet_link.live.test.ts` reads `IMPORT_TEST_SHEET_URL` (a
  placeholder sheet holding the scrubbed sample) and is skipped when it is unset.

## Two-step import (`import_service.ts`, R4)

```ts
type ImportSource = { kind: 'csv'; csv: string } | { kind: 'sheet'; url: string }
previewImport(db, source, { userId?: string; fetch?: typeof fetch }): Promise<ImportPreview>
confirmImport(db, importId, { userId?: string }): Promise<{ unitId: string }>
cancelImport(db, importId): Promise<void>
getLessonWarnings(db, lessonId): Promise<ImportWarning[]>

type ImportPreview = {
  importId: string
  unit: ParsedOutline['unit']
  arcs: { name: string; description: string }[]
  lessons: PreviewItem[] // the 41 numbered lessons
  flexDays: PreviewItem[] // the 6 flex days
  warnings: ImportWarning[] // all warnings, including every unknown standard code
}
type PreviewItem = {
  position: number; lessonNumber: number | null; arcName: string; lessonType: string
  title: string // first line of the description
  description: string
  focusStandards: string[] // normalized
  warnings: ImportWarning[]
}
```

- `previewImport` parses and normalizes (known codes come from the `standards` table) and keeps a
  pending import that survives between requests (e.g. a `pending_imports` table). It creates no
  `units` row. A sheet error rejects with `SheetAccessError` and stores nothing.
- `confirmImport` writes `units`, `arcs`, `lessons` (flex days as `is_flex = true`, no lesson
  number) and `lesson_standards` (one row per normalized code, `kind` per column, `position` in
  cell order) in one transaction, then drops the pending import. Unknown codes are stored and
  their warnings are kept per lesson (`getLessonWarnings`).
- `cancelImport` drops the pending import; confirming it afterwards rejects with
  `ImportNotFoundError`.

## ELD file (`parse_eld.ts`, `eld_service.ts`, R5)

- ELD rows are grouped by arc and lesson type (both trimmed, case-insensitive). The n-th ELD row
  of a group matches the n-th outline item (lesson or flex day) with the same arc and type.
  When that finds no item, a row whose Filename starts with `L<n>_` matches the lesson numbered
  n in the same arc, unless that lesson is already matched (D-028). A row without a match yields
  a warning naming its filename.
- `matchEldRows(rows, items)` returns `matches: { position, fields }[]` (the outline item's
  `position`) and `warnings`. `fields` keeps only non-empty content fields:
  `eldStandards, languageObjective, contentObjective, ideasLaunch, ideasLiteracyLab,
ideasLearningInAction, ideasLookBack, routines`.
- `attachEldFile` stores those fields per lesson and returns `{ matched, warnings }`;
  `getLessonEldInput(db, lessonId)` returns the stored fields or `null`. Generation (M2) reads it.
- `attachEldFile` also stores the unmatched-row warnings on the unit, replacing earlier ones;
  `getUnitEldWarnings(db, unitId)` returns them (`[]` when none or the unit is unknown) so the UI
  can show them after the import (D-028).
