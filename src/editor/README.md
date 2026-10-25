# Lesson editor and collaboration (M3: R17, R18, R19, R15 popover/picker, R14 versions UI, R23 lock)

The tests below were written first (red) and define this contract. Names, file paths, return
shapes, document names, message formats and accessible names are what the tests use; anything not
listed is up to the implementation. The lesson Zod schema in `src/lesson/schema.ts` stays the
single source of truth (D-016): the editor schema is derived from it and every snapshot is
validated with it.

| Test file                                 | Kind        | Covers                                                                 |
| ----------------------------------------- | ----------- | ---------------------------------------------------------------------- |
| `src/editor/schema.test.ts`               | unit        | derived schema, lesson -> doc -> lesson round trip                     |
| `src/editor/commands.test.ts`             | unit        | R17 edits that keep the lesson valid, R15/R17 standards from reference |
| `src/collab/idle_versions.test.ts`        | unit (fake) | D-024 (4): version after 30 s idle                                     |
| `src/collab/lesson_collab.int.test.ts`    | integration | seed, snapshot, idle version, flush, restore, D-032 (1) lock, auth     |
| `src/collab/collab.int.test.ts` (updated) | integration | M0 auth test now uses a real `lesson:<id>` document                    |
| `tests/e2e/collab.spec.ts`                | e2e         | R18: two contexts, < 1 s, names/cursors, concurrent typing, reopen     |
| `tests/e2e/lesson_view.spec.ts`           | e2e         | R19 view (desktop, 390 wide), R15 hover/focus popover                  |
| `tests/e2e/editor.spec.ts`                | e2e         | R17 structure, R15 picker, R14 history/preview/restore, R23 approved   |

Fixtures: `tests/fixtures/lesson/rich_lesson_fixture.ts` (every block type, every optional field,
ids everywhere, `**bold**`/`*italic*`, `&`, `<`, typographic quotes, empty strings and empty
arrays); the M2 core and flex fixtures; `tests/fixtures/standards/*.json` as reference data.
E2E helpers: `tests/e2e/lesson_support.ts` writes units, lessons and versions straight into the
e2e database. No test calls Anthropic.

Packages: Tiptap 3 (`@tiptap/core`, `@tiptap/pm`, `@tiptap/react`, the collaboration extensions)
and `y-prosemirror`/`@tiptap/y-tiptap` are the implementation's to add. The unit tests only
`import type` from `@tiptap/pm/model` and `@tiptap/pm/state`.

## `src/editor/schema.ts` (isomorphic: browser, Node unit tests, collab server)

```ts
lessonEditorExtensions(): Extensions // the Tiptap extensions; the editor UI and the server both use them
lessonSchema: Schema                 // getSchema(lessonEditorExtensions()) (prosemirror-model Schema)
blockNodeName(type: Block['type']): string
SECTION_NODE: string                 // node name of a section
PART_NODE: string                    // node name of a part
```

- The top node is `doc`. Derived 1:1 from the Zod schema: every type in `BLOCK_TYPES` has exactly
  one node, named `blockNodeName(type)` (names unique), whose `spec.group` includes `lessonBlock`;
  no other node is in that group. Adding a block type to the Zod schema without a node fails the
  test.
- Section, part and every block node have an `id` attribute.
- Marks are exactly `bold` and `italic` (inline text is `**bold**` / `*italic*` in the JSON).
- Front-matter standards are atom leaf nodes with a `code` attribute (chips; text can't be typed
  into them). Pacing is not a node: it's derived from section minutes.

## `src/editor/convert.ts`

```ts
type SnapshotResult =
  | { ok: true; lesson: LessonContent }
  | { ok: false; errors: LessonValidationError[] } // code 'schema', dotted path as validateLesson
lessonToDoc(content: LessonContent): JSONContent   // ProseMirror JSON, valid in lessonSchema
docToLesson(doc: JSONContent): SnapshotResult       // never throws for a schema-valid PM doc
```

- `docToLesson(lessonToDoc(x))` deep-equals `x` for any valid lesson with ids: every field, every
  optional field present or absent (an absent optional field stays absent; `''` and `[]` stay),
  order of sections, parts, blocks, list items, table cells, options. `**bold**` and `*italic*`
  become `bold`/`italic` marks on text nodes (no literal asterisks in the doc) and serialize back
  to the same string.
- Sections, parts and blocks without an `id` get a fresh unique id in `lessonToDoc`; given ids are
  kept. So id-less input round-trips to itself plus ids.
- `docToLesson` validates with `LessonContent` (the Zod schema) only; the R7 cross-field checks
  (minutes total, focus tagging) are not enforced on editor snapshots, so a reviewer mid-edit isn't
  blocked. An empty required text (e.g. a Say block with no text) is an error at its path, e.g.
  `body.sections.0.parts.0.blocks.1.text`.

## `src/editor/state.ts`, `src/editor/commands.ts`, `src/editor/standards.ts`

```ts
createLessonState(content: LessonContent): EditorState // prosemirror-state, schema lessonSchema
stateToLesson(state: EditorState): SnapshotResult

// ProseMirror commands; they return false and change nothing when the target id is unknown.
addBlock(afterBlockId: string, type: Block['type']): Command // empty block of that type after it
removeBlock(blockId: string): Command                         // false for the last block of a part
addListItem(listBlockId: string): Command                     // empty item at the end
removeListItem(listBlockId: string, index: number): Command   // false for the only item
addPart(sectionId: string): Command  // new part at the end: standards [], one empty paragraph block
removePart(partId: string): Command  // false for the only part of a section

type StandardRef = { code: string; framework: StandardFramework; strand: string; text: string }
type StandardGroup = 'focusStandards' | 'supportingStandards' | 'eldStandards'
searchStandards(reference: StandardRef[], query: string, options?: { exclude?: string[]; limit?: number }): StandardRef[]
addStandard(group: StandardGroup, code: string, reference: StandardRef[]): Command
removeStandard(group: StandardGroup, code: string): Command
```

- New blocks, parts and items get fresh ids. A new block's text fields are empty, so the snapshot
  is invalid until the reviewer types; once filled in, the lesson validates (R17). The text fields
  of a block are its textblocks in schema field order (an Ask block: question, then exemplar); the
  last textblock of a list is its last item.
- `searchStandards`: case-insensitive; a code prefix (`rl.6`) or a word of the text/strand
  matches; code matches first; `exclude` drops codes already chosen; default limit 8.
- `addStandard` adds a chip only for a code in `reference`, not already in the group; ELD codes
  (`framework: 'CA_ELD'`) only in `eldStandards` (added with levels `['Em','Ex','Br']`) and only
  ELD codes there. `removeStandard` refuses to remove the last focus standard (schema min 1).
  Unknown codes already in a lesson (R3 warnings) are kept and shown as warning chips.

## `src/editor/ydoc.ts`

```ts
lessonDocumentName(lessonId: string): string // `lesson:${lessonId}`
LESSON_FRAGMENT = 'default'                    // Y.XmlFragment the Tiptap Collaboration extension uses
lessonToYDoc(content: LessonContent): Y.Doc
yDocToLesson(doc: Y.Doc): SnapshotResult
```

Yjs holds the ProseMirror doc the y-prosemirror way: one `Y.XmlElement` per node, `nodeName` =
the node name, node attributes (including `id`) as element attributes, text in `Y.XmlText`.

## Collab server (`src/collab/`)

```ts
startCollabServer({ databaseUrl, port, authSecret, versionIdleMs?: number /* VERSION_IDLE_MS */, storeDebounceMs?: number })
// src/collab/idle_versions.ts
VERSION_IDLE_MS = 30_000
createIdleVersioner({ onIdle: (documentName: string, userId: string) => void | Promise<void>, idleMs?: number }) -> {
  touch(documentName, userId): void // an edit; (re)starts that document's timer, remembers the editor
  flush(documentName): Promise<void> // run onIdle now if pending, cancel the timer
  cancel(documentName): void         // drop a pending version
  pending(documentName): boolean
  stop(): void
}
```

- **Documents.** Only `lesson:<uuid>` of an existing lesson with content. Anything else (other
  names, malformed or unknown ids, null content) is rejected in `onAuthenticate`, before any load,
  so nothing is stored. Missing/invalid/expired tokens are rejected as in D-021.
- **Seed.** First load with no `yjs_documents` row builds the doc from `lessons.content`
  (`lessonToYDoc`). Later loads use the stored Yjs state, also after a collab restart.
- **Snapshot.** Each store (debounced by `storeDebounceMs`, default ≤ 1 s, max wait ≤ 5 s) writes
  the Yjs state to `yjs_documents`, then `yDocToLesson`; when valid and the lesson is editable it
  sets `lessons.content`, `last_edited_by` (the connection user who made the last change) and
  `updated_at`. No version is created by a store and the status never changes. An invalid snapshot
  keeps the last valid `lessons.content` (the Yjs state is still stored).
- **Idle versions (D-024 (4)).** After `versionIdleMs` without changes to a document, a
  `lesson_versions` row authored by the last editor is inserted with the current content, unless
  it equals the latest version's content (so submit's or restore's version isn't duplicated).
- **Flush (before submit, approve, restore).** A client sends the stateless message
  `{"type":"flush"}`; the server stores the document now and answers that connection with
  `{"type":"flushed","ok":true}`, or `{"type":"flushed","ok":false,"reason":"invalid"|"locked"}`.
  The editor flushes before calling the submit/resubmit/approve/restore routes, whose own
  snapshot (D-030) then captures the latest edits.
- **Content replaced outside the editor.** `restoreVersion` (and M2 regeneration when it writes
  `lessons.content`) delete the lesson's `yjs_documents` row and `NOTIFY lesson_content_replaced,
'<lessonId>'` in the same transaction. The collab server LISTENs and, if the document is loaded,
  replaces its content with `lessons.content` in one Yjs transaction (every connected editor sees
  the restored lesson within 2 s), cancelling a pending idle version; the next store must not write
  the pre-restore edits back.
- **Lock (R23, D-032 (1)).** Approved and Generating lessons connect read-only (the provider's
  `authorizedScope` is `'readonly'`): they load and display, but their updates are not applied or
  stored, `lessons.content`, `last_edited_by` and versions don't change, and flush answers
  `locked`. A lesson that becomes locked while editors are connected stops accepting writes at
  once (status changes `NOTIFY lesson_status_changed, '<lessonId>'`, and every store calls
  `assertLessonEditable` before writing), and other users keep seeing the approved content.
  Reopen makes it writable again.

## Web app

- `COLLAB_URL` (env; default `ws://localhost:4200`; e2e `ws://localhost:3411`): the WebSocket URL
  the browser uses, passed from the server component to the editor. The editor gets its token from
  `GET /api/collab-token` as a function, so reconnects fetch a fresh one (D-021).
- `src/app/(app)/lessons/[id]/page.tsx`: the editor. `src/app/(app)/lessons/[id]/view/page.tsx`:
  the read-only view (R19). Both for any signed-in role; unknown id -> 404.

### Editor page (mockups `R17-lesson-editor`, `R15-standard-picker`, `R14-*`, `R23-approved-locked`)

- The document is an `article` named `Lesson N editor` (`Lesson Flex day editor` for flex days is
  fine). When editable, the ProseMirror root inside it has `role="textbox"`,
  `aria-multiline="true"` and the same name `Lesson N editor`; when locked there is no textbox.
- The outline rail is a `nav` named `Lesson outline`. Section headings are level 2 and include
  the section name; pacing reads "Built from the section minutes below. Total 50 of 50 minutes."
  Typed blocks show visible labels (Say, Ask, Exemplar, Directions, Teacher tip, Pulse check, ...).
  "Add a part" is a button in Learning in Action.
- Presence: an element labelled `Also editing: <names>` (comma-separated, other users only) in the
  lesson bar. Remote carets show the user's name as text inside the document (aria-hidden is fine).
  The save state reads `All changes saved` once the server has the latest edits.
- Standards: chips are buttons named by the code, with `aria-describedby` pointing at a `tooltip`
  that holds the code, strand and full text from the `standards` table; it opens on hover and on
  focus and closes on mouse leave and Escape. Each group has a button `Add focus standard`,
  `Add supporting standard`, `Add ELD standard` opening a `combobox` named `Find a standard` with
  a `listbox` of `option`s (code, strand, start of the text) from the reference data only; Enter
  with no matching option adds nothing.
- Versions: the lesson bar button `Version history` opens the side panel `tablist` with tab
  `Versions` selected and its `tabpanel` (named `Versions`): the caption "A version is saved each
  time edits pause for 30 seconds, and before any regenerate or restore.", then a list (newest
  first) with one `listitem` per version showing time and author name (`System` for generated);
  each item's first button opens that version. The preview is read-only and shows "Viewing the
  version from ..." with buttons `Restore this version` and `Back to current`. Restore opens an
  `alertdialog` with heading "Restore the version from <time>?", focus on `Cancel`, and
  `Restore version`, which flushes, calls the restore route and leaves every open editor showing
  the restored content.
- Approved: a `status` notice "This lesson is approved, so editing is locked. ..." and, for
  approvers, `Reopen for edits`; reviewers see "Locked. Ask an approver to reopen." No add
  buttons, no textbox, typing changes nothing.

### Lesson view (mockups `R19-lesson-view`, `R19-lesson-view-mobile`)

- An `article` named `Lesson N` with a level-1 heading `Lesson N: <body title>` and the kicker
  `Unit <unitNumber>: <unitTitle>`; arc, type and `50 min`.
- Front matter as a description list with terms Focus standards, Supporting standards, ELD
  standards, Lesson texts, Vocabulary, Materials (standards as the same popover chips); headings
  Student learning objectives, Essential questions, Connections.
- `Lesson pacing` heading, a table with column headers `Lesson flow` and `Purpose of learning
experience`, one row per section with a cell `<Section>, <n> min`, then "Total 50 of 50
  minutes.".
- The sequence: level-2 headings `1 Launch`, `2 Literacy Lab`, `3 Learning in Action`,
  `4 Look Back` (number then name in the accessible name), `Homework` unnumbered; parts are level-3
  headings `Part <label>: <title>`. Inline labels "Say:", "Ask:", "Exemplar response"; pulse-check
  options labelled `Option A` ... with `, correct` on the right one; ELD and support boxes expanded.
- No textbox. The bar has an `HTML` button and an `Open editor` link to `/lessons/<id>`.
- At 390 wide a `nav` named `Sections` holds links that jump to each section.

## E2E harness changes (in this commit)

`tests/e2e/server.ts` starts the collab server in-process on `E2E_COLLAB_PORT` (default
`E2E_PORT + 1` = 3411) with the e2e `AUTH_SECRET`, and passes `COLLAB_URL` to `next dev`.
`resetImports` also truncates `yjs_documents`. Screenshots: `R17-lesson-editor`,
`R15-standard-picker`, `R14-version-history`, `R14-restore-confirm`, `R23-approved-locked`,
`R19-lesson-view`, `R19-lesson-view-mobile` under `test-results/screens/`.
