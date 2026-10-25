# Lesson content schema (M2: D-016, R7, R8)

`src/lesson/schema.test.ts` was written first (red) and defines this contract. Fixtures:
`tests/fixtures/lesson/lesson_fixture.ts` (invented placeholder prose, one core and one flex day).

## `src/lesson/schema.ts`

One Zod 4 module is the source of truth for the model's structured output, validation of every
generated lesson and every editor snapshot, and (in M3) the Tiptap node set.

| Export                                   | What                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| `LessonContent` (schema + type)          | `{ schemaVersion: 1, frontMatter: LessonFrontMatter, body: LessonBody }` |
| `LessonFrontMatter` (schema + type)      | copied from the outline row, not generated                               |
| `LessonBody` (schema + type)             | what the model generates                                                 |
| `Section`, `Part`, `Block`, `LessonType` | schemas + types                                                          |
| `BLOCK_TYPES`                            | readonly array of the 18 block `type` literals                           |
| `validateLesson(content, expectations)`  | schema parse + cross-field checks, see below                             |
| `lessonBodyJsonSchema()`                 | JSON schema of `LessonBody` for structured output (`z.toJSONSchema`)     |
| `lessonTypeFromOutline(raw)`             | outline "Type of Lesson" cell -> `LessonType`                            |
| `LessonValidationError` (type)           | `{ code, path, message }`                                                |

Shape (field names the fixture uses; follow the private schema proposal for the rest):

- `frontMatter`: `unitTitle`, `number` (int, **null for flex days**), `arc`, `type`, `title`,
  `durationMinutes`, `focusStandards: string[]` (min 1), `supportingStandards`,
  `eldStandards: { code, levels: ('Em'|'Ex'|'Br')[] }[]`, `texts: { title, source?, kind, pages? }[]`.
  Standard codes are not regex-restricted to `RL.6.1` shapes: `RH.6-8.1`, `LIB.6.2.1.a`,
  `ELD.PI.6.6.a`, `ELD.PII.6.3` must all be accepted (D-017 codes).
- `body`: `title`, `objectives { content, language, foundationalSkills? }`,
  `essentialQuestions` (1-2), `connections { knowledgeBuilding, enduringUnderstanding,
futureLessons, unitPerformanceTask }`, `vocabulary { addressed, support }`, `materials`,
  `sections`, `homework { intro?, tasks, teacherTip? } | null`.
- `Section`: `{ id?, kind: 'launch'|'literacy_lab'|'learning_in_action'|'look_back', minutes,
purpose, parts }`. `Part`: `{ id?, label?, title?, standards: string[], minutes?, purpose?,
blocks }`.
- `Block`: discriminated union on `type`: `routine, teach, paragraph, say, directions, ask
(question + exemplar, both required), connection, display, list, table, teacher_tip,
sentence_starter, pulse_check (4 options, exactly one correct, each with a rationale),
check_for_understanding, reflection, eld_instructions, student_support, rubric`.
- `LessonType`: `spark, core_reading, core_writing, academic_discussion, writing, presentation,
research, flex, other`.
- Text is plain strings with `**bold**` / `*italic*` only. `id`s are optional in model output.

## `validateLesson(content: unknown, { focusStandards: string[], days: number })`

Returns `{ ok: true, lesson: LessonContent }` or `{ ok: false, errors: LessonValidationError[] }`.
`focusStandards` and `days` come from the outline row (normalized `lesson_standards` with kind
`focus`, and `lessons.days`). Errors are precise enough to send back to the model in a repair
prompt:

| `code`                    | `path`                                                   | When                                                                 |
| ------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------- |
| `schema`                  | dotted Zod path, e.g. `body.sections.2.parts.0.blocks.5` | Zod parse failed (unknown block type, missing field...)              |
| `minutes_total`           | `body.sections`                                          | sum of section minutes != 50 x days; message gives both numbers      |
| `duration`                | `frontMatter.durationMinutes`                            | front matter duration != 50 x days                                   |
| `focus_standard_missing`  | `frontMatter.focusStandards`                             | an outline focus standard is not in the front matter (message: code) |
| `focus_standard_untagged` | `body.sections`                                          | a focus standard is on no `learning_in_action` part (message: code)  |

Cross-field checks run only after the schema parse succeeds, and all of them are reported (not
just the first). Further checks from the proposal (section order, ELD frames, type rules) may be
added as long as both fixtures stay valid.

## `lessonTypeFromOutline(raw)`

Case- and space-insensitive: `Spark N` -> `spark`, `Core Reading` -> `core_reading`,
`Core Writing (Double Lesson)` -> `core_writing`, `Academic Discussion` -> `academic_discussion`,
`Writing` -> `writing`, `End-of-Arc Flex Day` -> `flex`, anything else -> `other`.
