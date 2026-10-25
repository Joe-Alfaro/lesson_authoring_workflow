// Builds units, lessons and users directly in the database for the workflow tests (R14, R23-R25),
// independent of the M1 importer and M2 generation.
import { inArray, like } from 'drizzle-orm'
import type { Database } from '../src/db/client'
import { arcs, lessons, units, users, type LessonStatus, type Role } from '../src/db/schema'

/** Every fixture user's email starts with this, so cleanup can find them. */
export const WORKFLOW_EMAIL_PREFIX = 'wf-test-'

export interface FixtureUser {
  id: string
  name: string
  role: Role
}

export async function createUser(db: Database, role: Role, key: string): Promise<FixtureUser> {
  const name = `Workflow ${key}`
  const [user] = await db
    .insert(users)
    .values({ email: `${WORKFLOW_EMAIL_PREFIX}${key}@example.com`, name, role, passwordHash: 'x' })
    .onConflictDoUpdate({ target: users.email, set: { name, role } })
    .returning({ id: users.id })
  return { id: user!.id, name, role }
}

/** One user per role plus a second reviewer. */
export async function createUsers(db: Database) {
  return {
    author: await createUser(db, 'author', 'author'),
    reviewer: await createUser(db, 'reviewer', 'reviewer'),
    reviewer2: await createUser(db, 'reviewer', 'reviewer2'),
    approver: await createUser(db, 'approver', 'approver'),
    admin: await createUser(db, 'admin', 'admin'),
  }
}

export type FixtureUsers = Awaited<ReturnType<typeof createUsers>>

export interface LessonSpec {
  /** Null for a flex day. */
  lessonNumber: number | null
  /** Index into `arcs` of createTestUnit. Default 0. */
  arc?: number
  status?: LessonStatus
  content?: unknown
  assigneeId?: string | null
  lastEditedBy?: string | null
  description?: string
}

export interface TestUnit {
  unitId: string
  arcIds: string[]
  /** Lesson ids in the order of `lessons`. */
  lessonIds: string[]
}

export function lessonContent(title: string, marker = title): unknown {
  return {
    schemaVersion: 1,
    frontMatter: { title },
    body: { title, sections: [{ kind: 'launch', marker }] },
  }
}

export async function createTestUnit(
  db: Database,
  options: { arcs?: string[]; lessons: LessonSpec[] },
): Promise<TestUnit> {
  const [unit] = await db
    .insert(units)
    .values({ grade: 6, unitNumber: 4, anchorTextTitle: 'Placeholder Anchor Novel', banner: 'G6' })
    .returning({ id: units.id })
  const arcNames = options.arcs ?? ['Investigation 1']
  const arcRows = await db
    .insert(arcs)
    .values(arcNames.map((name, position) => ({ unitId: unit!.id, name, position })))
    .returning({ id: arcs.id, position: arcs.position })
  const arcIds = arcRows.sort((a, b) => a.position - b.position).map((row) => row.id)

  const lessonRows = await db
    .insert(lessons)
    .values(
      options.lessons.map((spec, position) => ({
        unitId: unit!.id,
        arcId: arcIds[spec.arc ?? 0]!,
        position,
        lessonNumber: spec.lessonNumber,
        isFlex: spec.lessonNumber === null,
        filename: spec.lessonNumber === null ? `FLEX${position}_TE` : `L${spec.lessonNumber}_TE`,
        lessonType: spec.lessonNumber === null ? 'End-of-Arc Flex Day' : 'Core Reading',
        description:
          spec.description ??
          (spec.lessonNumber === null
            ? `Flex day ${position}.`
            : `Lesson ${spec.lessonNumber} outline line.\nSecond line.`),
        rawRow: {},
        status: spec.status ?? 'draft',
        content: spec.content ?? null,
        assigneeId: spec.assigneeId ?? null,
        lastEditedBy: spec.lastEditedBy ?? null,
      })),
    )
    .returning({ id: lessons.id, position: lessons.position })
  const lessonIds = lessonRows.sort((a, b) => a.position - b.position).map((row) => row.id)
  return { unitId: unit!.id, arcIds, lessonIds }
}

/** Removes every unit (cascading to lessons, versions and events) and the fixture users. */
export async function cleanWorkflowData(db: Database): Promise<void> {
  await db.delete(units)
  const fixtureUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, `${WORKFLOW_EMAIL_PREFIX}%`))
  if (fixtureUsers.length > 0) {
    await db.delete(users).where(
      inArray(
        users.id,
        fixtureUsers.map((user) => user.id),
      ),
    )
  }
}
