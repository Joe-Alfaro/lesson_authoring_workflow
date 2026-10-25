import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connectTestDb } from '../../tests/db'
import { runMigrations } from '../db/migrate'
import { seedUsers } from '../db/seed/users'
import { verifyCredentials } from './credentials'

describe('verifyCredentials', () => {
  const { pool, db } = connectTestDb()

  beforeAll(async () => {
    await runMigrations(pool)
    await seedUsers(db, 'correct-password')
  })
  afterAll(() => pool.end())

  it('returns the seeded user with their role', async () => {
    expect(await verifyCredentials(db, 'Approver01@example.com', 'correct-password')).toMatchObject(
      { email: 'approver01@example.com', role: 'approver' },
    )
  })

  it('rejects a wrong password or an unknown email', async () => {
    expect(await verifyCredentials(db, 'approver01@example.com', 'wrong')).toBeNull()
    expect(await verifyCredentials(db, 'nobody@example.com', 'correct-password')).toBeNull()
  })
})
