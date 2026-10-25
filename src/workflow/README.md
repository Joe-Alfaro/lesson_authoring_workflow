# Review workflow (M4 backend: R14 versions, R23, R24, R25)

The tests in this folder and `src/app/api/workflow.int.test.ts` were written first (red) and
define the contract below. Names, file paths and return shapes are what the tests import; anything
not listed is up to the implementation. Fixtures: `tests/workflow_fixtures.ts` (builds units,
lessons and `wf-test-*` users directly in the database, independent of M1 and M2).

## Modules

| File                          | Exports                                                                                                                                                             | Kind |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `src/workflow/transitions.ts` | `WORKFLOW_ACTIONS`, `WorkflowAction`, `planTransition`, `availableActions`, `isEditableStatus`, `STATUS_LABELS`                                                     | pure |
| `src/workflow/errors.ts`      | `LessonNotFoundError`, `VersionNotFoundError`, `WorkflowForbiddenError`, `InvalidTransitionError`, `NoteRequiredError`, `LessonLockedError`, `InvalidAssigneeError` | -    |
| `src/workflow/service.ts`     | `transitionLesson`, `applySystemTransition`, `getLessonHistory`, `assertLessonEditable`                                                                             | DB   |
| `src/workflow/versions.ts`    | `saveLessonContent`, `listVersions`, `getVersion`, `restoreVersion`                                                                                                 | DB   |
| `src/workflow/dashboard.ts`   | `getUnitDashboard`, `getMyLessons`                                                                                                                                  | DB   |
| `src/workflow/assignment.ts`  | `assignLessons`, `listAssignableReviewers`                                                                                                                          | DB   |

Every DB function takes the Drizzle `Database` first. Malformed UUIDs behave like unknown ids (no
Postgres error leaks).

## Transitions (`transitions.ts`, R23)

| Action            | From              | To                | Roles (admin always passes) | Note     |
| ----------------- | ----------------- | ----------------- | --------------------------- | -------- |
| `submit`          | draft             | in_review         | reviewer, approver          | optional |
| `resubmit`        | changes_requested | in_review         | reviewer, approver          | optional |
| `request_changes` | in_review         | changes_requested | approver                    | required |
| `approve`         | in_review         | approved          | approver                    | optional |
| `reopen`          | approved          | in_review         | approver                    | optional |

```ts
planTransition({ status, action, role, note? }) ->
  { ok: true, to: LessonStatus } | { ok: false, reason: 'forbidden' | 'invalid_transition' | 'note_required' }
availableActions(status, role) -> WorkflowAction[] // exactly the actions planTransition allows
isEditableStatus(status) -> boolean // false for 'approved' and 'generating'
STATUS_LABELS: Record<LessonStatus, string> // 'Generating', 'Draft', 'In review', 'Changes requested', 'Approved', 'Failed'
```

- Checks run in this order: role (`forbidden`), then status (`invalid_transition`), then note. A
  note is blank when it is missing or only whitespace.
- Authors take no review action (roles table: reviewers submit; approvers do what reviewers do
  plus approve and send back). Changes requested returns to In review only by `resubmit` (D-024);
  editing does not move the status.
- Generating, Draft and Failed changes made by generation are system transitions (below), not
  actions.

## Service (`service.ts`)

```ts
type Actor = { id: string; role: Role }
type HistoryEvent = { id; fromStatus: LessonStatus | null; toStatus: LessonStatus;
  actor: { id; name; role } | null; note: string | null; at: Date }

transitionLesson(db, { lessonId, action, actor: Actor, note?: string | null })
  -> { status: LessonStatus; event: HistoryEvent }
applySystemTransition(db, { lessonId, to: 'generating' | 'draft' | 'failed', note? }) -> void
getLessonHistory(db, lessonId) -> HistoryEvent[] // oldest first
assertLessonEditable(db, lessonId) -> void // throws LessonLockedError when approved or generating
```

- `transitionLesson` throws `LessonNotFoundError`, `WorkflowForbiddenError`,
  `InvalidTransitionError` or `NoteRequiredError` (mapped from `planTransition`) and then writes
  nothing. `submit` of a Draft with null `content` (never generated) is an
  `InvalidTransitionError`.
- On success, in one transaction: update `lessons.status` conditionally on the status it read
  (two concurrent transitions: exactly one wins, the other throws `InvalidTransitionError`) and
  insert one `workflow_events` row (`from_status`, `to_status`, `actor_id`, trimmed `note` or
  null, `at`).
- Before `submit`, `resubmit` and `approve` (D-024), the current `content` is saved as a
  `lesson_versions` row authored by the actor, unless it equals the latest version's content.
- `applySystemTransition` is for generation (M2's worker should call it): any status except
  `generating` -> `generating`; `generating` -> `draft` | `failed`. Anything else throws
  `InvalidTransitionError`. It writes a `workflow_events` row with `actor_id` null.
- `assertLessonEditable` is the approved lock for every edit path (content saves, restore, and
  the collab server once M3 wires it in).

## Versions (`versions.ts`, R14)

```ts
type VersionSummary = { id; createdAt: Date; author: { id; name } | null } // null = generated
saveLessonContent(db, { lessonId, userId, content }) -> { versionId }
listVersions(db, lessonId) -> VersionSummary[] // newest first, no content
getVersion(db, { lessonId, versionId }) -> (VersionSummary & { lessonId; content }) | null
restoreVersion(db, { lessonId, versionId, userId }) -> { versionId } // the new version
```

- `saveLessonContent` is the editor's save after 30 s of idle editing (D-024): sets `content`,
  `last_edited_by = userId`, `updated_at = now()` and inserts a version authored by `userId`. It
  does not change the status. Content validation against the lesson schema is out of scope here.
- `restoreVersion`: if the current content differs from the latest version, it is first saved as a
  version by `userId`; then the chosen version's content becomes the lesson content (last editor
  `userId`) and is appended as a new version by `userId`. Earlier versions are kept.
- Both reject with `LessonLockedError` while the lesson is approved or generating, and
  `LessonNotFoundError` for an unknown lesson. `restoreVersion` throws `VersionNotFoundError` when
  the version is unknown or belongs to another lesson; `getVersion` returns null then.
- Ordering is by `created_at`; versions (and events) inserted by one call must get strictly
  increasing timestamps (for example `clock_timestamp()` rather than the transaction's `now()`).

## Dashboard (`dashboard.ts`, R24, R25)

```ts
type DashboardLesson = { id; lessonNumber: number | null; isFlex: boolean; position: number;
  title: string; outlineLine: string; lessonType: string; arc: { id; name } | null;
  status: LessonStatus; assignee: { id; name } | null; lastEditor: { id; name } | null; updatedAt: Date }
type DashboardFilters = { status?: LessonStatus[]; arcId?: string; assigneeId?: string | null }
getUnitDashboard(db, unitId, filters?) -> {
  unit: { id; grade; unitNumber; anchorTextTitle }; arcs: { id; name; position }[];
  lessons: DashboardLesson[]; counts: Record<LessonStatus, number>; total: number; complete: boolean } | null
getMyLessons(db, userId) -> { units: { unit; counts; lessons: DashboardLesson[] }[] }
```

- Lessons in outline order (`position`), flex days included. `outlineLine` is the first line of the
  outline description; `title` is `content.body.title` when content exists (D-024 (7)), otherwise
  `outlineLine`.
- Filters combine with AND; `status` matches any listed status; `assigneeId: null` means
  unassigned. `counts`, `total` and `complete` ignore filters.
- `counts` (every key present), `total` and `complete` cover **numbered lessons only**: flex days
  are generated on demand, so an ungenerated flex day does not hold the unit back. `complete` is
  true when `total > 0` and every numbered lesson is approved.
- `getUnitDashboard` returns null for an unknown unit. `getMyLessons` lists the lessons assigned
  to `userId`, grouped by unit, with per-unit counts of those lessons.

## Assignment (`assignment.ts`, R25)

```ts
assignLessons(db, { lessonIds: string[]; assigneeId: string | null }) -> { updated: number }
listAssignableReviewers(db) -> { id; name; email; role: 'reviewer' | 'approver'; openAssignments: number }[]
```

- Single and bulk are the same call; it replaces the current assignee, `null` unassigns, `[]`
  updates nothing. The assignee must be a reviewer or approver, else `InvalidAssigneeError`. Any
  unknown lesson id rejects the whole batch with `LessonNotFoundError` (all or nothing).
- `listAssignableReviewers` is the picker: reviewers and approvers sorted by name, with the
  number of assigned lessons that are not approved.

## API routes

Each route calls `requireRole` from `src/auth/require_role.ts` first (403 for the wrong role;
admins pass) and uses the session user as actor. Errors answer JSON `{ error }`:
`LessonNotFoundError`/`VersionNotFoundError` 404, `WorkflowForbiddenError` 403,
`InvalidTransitionError`/`LessonLockedError` 409, `NoteRequiredError`/`InvalidAssigneeError`/bad
body 400. Dates are ISO strings. Dynamic params are `{ params: Promise<{ ... }> }`.

| Route                                                            | Method | requireRole                | Body / query                                            | Success                                 |
| ---------------------------------------------------------------- | ------ | -------------------------- | ------------------------------------------------------- | --------------------------------------- |
| `src/app/api/lessons/[id]/transitions/route.ts`                  | POST   | author, reviewer, approver | `{ action, note? }`                                     | 200 `{ status }`                        |
| `src/app/api/lessons/[id]/history/route.ts`                      | GET    | author, reviewer, approver |                                                         | 200 `{ events: HistoryEvent[] }`        |
| `src/app/api/lessons/[id]/content/route.ts`                      | PUT    | author, reviewer, approver | `{ content }` (required)                                | 200 `{ versionId }`                     |
| `src/app/api/lessons/[id]/versions/route.ts`                     | GET    | author, reviewer, approver |                                                         | 200 `{ versions: VersionSummary[] }`    |
| `src/app/api/lessons/[id]/versions/[versionId]/route.ts`         | GET    | author, reviewer, approver |                                                         | 200 version with content                |
| `src/app/api/lessons/[id]/versions/[versionId]/restore/route.ts` | POST   | author, reviewer, approver |                                                         | 201 `{ versionId }`                     |
| `src/app/api/lessons/assign/route.ts`                            | POST   | author, approver           | `{ lessonIds: string[], assigneeId \| null }`           | 200 `{ updated }`                       |
| `src/app/api/units/[id]/dashboard/route.ts`                      | GET    | author, reviewer, approver | `?status=a&status=b&arc=<id>&assignee=<id>\|unassigned` | 200 dashboard; 400 unknown status       |
| `src/app/api/reviewers/route.ts`                                 | GET    | author, approver           |                                                         | 200 `{ reviewers }`                     |
| `src/app/api/me/lessons/route.ts`                                | GET    | author, reviewer, approver |                                                         | 200 `getMyLessons` for the session user |

The role decision for transitions is the service's (`WorkflowForbiddenError` -> 403), so a
reviewer calling approve gets 403 (R27).

## Not in this module

Generation runs, regenerate and its pre-regenerate version (M2), outline import (M1), the editor
and collab server wiring (M3), comments (R26).
