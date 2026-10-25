import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/** Loads `.env` from the working directory for standalone processes (Next.js loads it itself). */
export function loadLocalEnv(path = resolve(process.cwd(), '.env')): void {
  if (existsSync(path)) {
    process.loadEnvFile(path)
  }
}
