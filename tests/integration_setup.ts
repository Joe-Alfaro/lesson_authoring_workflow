import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import type { TestProject } from 'vitest/node'

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string
  }
}

/**
 * Starts a throwaway Postgres 16 for the integration project. Set TEST_DATABASE_URL to use an
 * existing empty database instead (for example the compose one) when Docker is not available.
 */
export default async function setup(project: TestProject) {
  const existing = process.env.TEST_DATABASE_URL
  if (existing) {
    project.provide('databaseUrl', existing)
    return
  }
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    'postgres:16-alpine',
  ).start()
  project.provide('databaseUrl', container.getConnectionUri())
  return async () => {
    await container.stop()
  }
}
