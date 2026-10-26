// AI assist settings from the environment. Contract: src/assist/README.md.
import { DEFAULT_MODEL } from '../generation/llm'

type Env = Record<string, string | undefined>

/** The assist model: `ASSIST_MODEL`, default the Haiku-class DEFAULT_MODEL (cheap, fast). */
export function getAssistModel(env: Env = process.env): string {
  return env.ASSIST_MODEL?.trim() || DEFAULT_MODEL
}
