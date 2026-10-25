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
