// The model behind AI assist in the web app: the Anthropic adapter with ANTHROPIC_API_KEY. The SDK
// also reads ANTHROPIC_BASE_URL, which is how the e2e run reaches its fake API. Route tests mock
// this module. Contract: src/assist/README.md.
import { createAnthropicLlmClient } from '../generation/anthropic_client'
import type { LlmClient } from '../generation/llm'
import { AssistUnavailableError } from './errors'
import { getAssistModel } from './settings'

let cached: { key: string; llm: LlmClient } | null = null

export function getAssistProvider(): { llm: LlmClient; model: string } {
  const key = process.env.ANTHROPIC_API_KEY?.trim()
  if (!key) {
    throw new AssistUnavailableError()
  }
  if (cached?.key !== key) {
    // Short answers: low thinking effort keeps them quick and cheap.
    cached = { key, llm: createAnthropicLlmClient({ apiKey: key, effort: 'low' }) }
  }
  return { llm: cached.llm, model: getAssistModel() }
}
