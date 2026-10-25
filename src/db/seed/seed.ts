import { resolve } from 'node:path'
import type { Database } from '../client'
import { loadStandards } from './standards'
import { seedUsers } from './users'

export const STANDARDS_DIR = resolve(import.meta.dirname, '../../../data/standards')

export interface SeedOptions {
  password: string
  standardsDir?: string
}

export interface SeedResult {
  users: number
  standards: number
}

export async function seed(db: Database, options: SeedOptions): Promise<SeedResult> {
  const usersCount = await seedUsers(db, options.password)
  const standardsCount = await loadStandards(db, options.standardsDir ?? STANDARDS_DIR)
  return { users: usersCount, standards: standardsCount }
}
