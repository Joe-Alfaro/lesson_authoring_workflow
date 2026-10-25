// R10: prompt versions per unit. Contract: src/generation/README.md.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connectTestDb } from '../../tests/db'
import { createTestUnit, createTestUser } from '../../tests/generation_fixtures'
import { runMigrations } from '../db/migrate'
import { DEFAULT_PROMPT_TEMPLATE, type PromptTemplate } from './prompt_template'
import {
  getCurrentPromptVersion,
  getPromptVersion,
  listPromptVersions,
  savePromptVersion,
} from './prompt_versions'

function template(marker: string): PromptTemplate {
  return {
    system: `System ${marker}`,
    styleGuide: `Style ${marker}`,
    typeGuidance: { core_reading: `Core reading ${marker}` },
  }
}

describe('prompt versions (R10)', () => {
  const { pool, db } = connectTestDb()

  beforeAll(async () => {
    await runMigrations(pool)
  })
  afterAll(() => pool.end())

  it('gives a new unit version 1 with the default template', async () => {
    const { unitId } = await createTestUnit(db, { lessons: 1 })

    const current = await getCurrentPromptVersion(db, unitId)

    expect(current).toEqual(
      expect.objectContaining({ unitId, version: 1, template: DEFAULT_PROMPT_TEMPLATE }),
    )
    expect(await getCurrentPromptVersion(db, unitId)).toEqual(current)
  })

  it('creates a new version on every save and keeps the old ones readable', async () => {
    const { unitId } = await createTestUnit(db, { lessons: 1 })
    const userId = await createTestUser(db, 'prompt-editor@example.com')
    const first = await getCurrentPromptVersion(db, unitId)

    const second = await savePromptVersion(db, { unitId, template: template('two'), userId })
    const third = await savePromptVersion(db, { unitId, template: template('three'), userId })

    expect(second.version).toBe(2)
    expect(third.version).toBe(3)
    expect((await getCurrentPromptVersion(db, unitId)).id).toBe(third.id)

    const all = await listPromptVersions(db, unitId)
    expect(all.map((v) => v.version)).toEqual([1, 2, 3])
    expect(all.map((v) => v.template)).toEqual([
      DEFAULT_PROMPT_TEMPLATE,
      template('two'),
      template('three'),
    ])
    expect(all[1]).toEqual(
      expect.objectContaining({ createdBy: userId, createdAt: expect.any(Date) }),
    )

    expect((await getPromptVersion(db, first.id))?.template).toEqual(DEFAULT_PROMPT_TEMPLATE)
    expect((await getPromptVersion(db, second.id))?.template).toEqual(template('two'))
  })

  it('numbers versions per unit', async () => {
    const a = await createTestUnit(db, { lessons: 1 })
    const b = await createTestUnit(db, { lessons: 1 })
    await savePromptVersion(db, { unitId: a.unitId, template: template('a') })

    expect(
      (await savePromptVersion(db, { unitId: b.unitId, template: template('b') })).version,
    ).toBe(1)
  })

  it('rejects an invalid template and stores nothing', async () => {
    const { unitId } = await createTestUnit(db, { lessons: 1 })
    const invalid = { styleGuide: 'no system instructions' } as unknown as PromptTemplate

    await expect(savePromptVersion(db, { unitId, template: invalid })).rejects.toThrow()
    expect(await listPromptVersions(db, unitId)).toEqual([])
  })

  it('returns null for an unknown version id', async () => {
    expect(await getPromptVersion(db, '00000000-0000-0000-0000-000000000000')).toBeNull()
  })
})
