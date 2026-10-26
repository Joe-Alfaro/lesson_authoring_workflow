function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production'
}

/** DATABASE_URL, or the docker compose database when running locally. */
export function getDatabaseUrl(): string {
  const url = readEnv('DATABASE_URL')
  if (url) {
    return url
  }
  if (isProduction()) {
    throw new Error('DATABASE_URL is required in production')
  }
  const port = readEnv('POSTGRES_PORT') ?? '5432'
  return `postgres://postgres:postgres@localhost:${port}/lesson_authoring`
}

/**
 * Size of each process's Postgres pool: `DB_POOL_MAX`, an integer >= 1, default 10. Live feeds
 * share one LISTEN connection outside the pool (src/db/notify_hub.ts), so this only bounds queries.
 */
export function getDbPoolMax(env: Record<string, string | undefined> = process.env): number {
  const raw = env.DB_POOL_MAX?.trim()
  if (!raw) return 10
  const max = Number(raw)
  if (!Number.isInteger(max) || max < 1) {
    throw new Error(`DB_POOL_MAX must be an integer >= 1, got "${raw}"`)
  }
  return max
}

/** pg-boss's own pool per process: `PGBOSS_POOL_MAX`, an integer >= 1, default 2. */
export function getPgBossPoolMax(env: Record<string, string | undefined> = process.env): number {
  const raw = env.PGBOSS_POOL_MAX?.trim()
  if (!raw) return 2
  const max = Number(raw)
  if (!Number.isInteger(max) || max < 1) {
    throw new Error(`PGBOSS_POOL_MAX must be an integer >= 1, got "${raw}"`)
  }
  return max
}

/** pg-boss constructor options: the database and a bounded pool (B1). */
export function pgBossOptions(
  connectionString: string,
  env: Record<string, string | undefined> = process.env,
): { connectionString: string; max: number } {
  return { connectionString, max: getPgBossPoolMax(env) }
}

export function getPort(defaultPort: number): number {
  const raw = readEnv('PORT')
  if (!raw) {
    return defaultPort
  }
  const port = Number(raw)
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`PORT must be a positive integer, got "${raw}"`)
  }
  return port
}

export const LOCAL_SEED_PASSWORD = 'demo-password'

/** SEED_PASSWORD, or the documented local default. Production must set it (R31). */
export function getSeedPassword(): string {
  const password = readEnv('SEED_PASSWORD')
  if (password) {
    return password
  }
  if (isProduction()) {
    throw new Error('SEED_PASSWORD is required in production')
  }
  return LOCAL_SEED_PASSWORD
}

/** AUTH_SECRET signs Auth.js sessions and the collab tokens, so web and collab must share it. */
export function getAuthSecret(): string {
  const secret = readEnv('AUTH_SECRET')
  if (!secret) {
    throw new Error('AUTH_SECRET is required (see .env.example)')
  }
  return secret
}

/** The collab WebSocket URL the browser connects to (COLLAB_URL; local collab port by default). */
export function getCollabUrl(): string {
  return readEnv('COLLAB_URL') ?? 'ws://localhost:4200'
}
