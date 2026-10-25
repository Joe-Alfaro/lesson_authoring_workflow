// Anthropic implementation of LlmClient (R7). Only src/worker constructs it; tests use a fake.
import Anthropic from '@anthropic-ai/sdk'
import type { LlmClient, LlmRequest, LlmResponse } from './llm'

/** Keywords structured outputs do not accept; validateLesson checks them after the call. */
const UNSUPPORTED_KEYWORDS = new Set([
  '$schema',
  'minLength',
  'maxLength',
  'pattern',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'maxItems',
  'uniqueItems',
])

/**
 * Adapts a Zod-generated JSON schema to what structured outputs accept: no numeric/string
 * constraints, `minItems` only 0 or 1, `anyOf` instead of `oneOf`, closed objects.
 */
export function toStructuredOutputSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    return schema.map(toStructuredOutputSchema)
  }
  if (!schema || typeof schema !== 'object') {
    return schema
  }
  const entries = Object.entries(schema as Record<string, unknown>)
    .filter(([key]) => !UNSUPPORTED_KEYWORDS.has(key))
    .filter(([key, value]) => key !== 'minItems' || (typeof value === 'number' && value <= 1))
    .map(([key, value]) => [key === 'oneOf' ? 'anyOf' : key, toStructuredOutputSchema(value)])
  const result = Object.fromEntries(entries) as Record<string, unknown>
  if (result.type === 'object' && result.properties) {
    result.additionalProperties = false
  }
  return result
}

export class LlmOutputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LlmOutputError'
  }
}

export function createAnthropicLlmClient({ apiKey }: { apiKey: string }): LlmClient {
  const client = new Anthropic({ apiKey })
  return {
    async generateStructured(request: LlmRequest): Promise<LlmResponse> {
      // Streaming keeps long generations clear of HTTP timeouts.
      const stream = client.messages.stream({
        model: request.model,
        max_tokens: request.maxTokens ?? 32_000,
        system: request.system,
        messages: [{ role: 'user', content: request.prompt }],
        output_config: {
          format: {
            type: 'json_schema',
            schema: toStructuredOutputSchema(request.schema) as Record<string, unknown>,
          },
        },
      })
      const message = await stream.finalMessage()
      const usage = {
        inputTokens:
          message.usage.input_tokens +
          (message.usage.cache_creation_input_tokens ?? 0) +
          (message.usage.cache_read_input_tokens ?? 0),
        outputTokens: message.usage.output_tokens,
      }
      if (message.stop_reason === 'refusal') {
        throw Object.assign(new LlmOutputError('The model declined to write this lesson'), {
          usage,
        })
      }
      if (message.stop_reason === 'max_tokens') {
        throw Object.assign(
          new LlmOutputError(`Output hit the ${request.maxTokens ?? 32_000} token limit`),
          { usage },
        )
      }
      const text = message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('')
      try {
        return { output: JSON.parse(text), usage, model: message.model }
      } catch {
        throw Object.assign(new LlmOutputError('The model returned invalid JSON'), { usage })
      }
    },
  }
}
