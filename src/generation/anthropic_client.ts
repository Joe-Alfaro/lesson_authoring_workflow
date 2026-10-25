// Anthropic implementation of LlmClient (R7). Only src/worker constructs it; tests use a fake.
//
// The lesson schema is too large for constrained decoding (structured outputs reject it: too
// many optional properties, then "compiled grammar is too large"), so the schema is passed as
// the input schema of a non-strict tool. The model follows it closely; validateLesson in the
// worker is the real gate and drives the repair retry (D-028).
import Anthropic from '@anthropic-ai/sdk'
import type { LlmClient, LlmRequest, LlmResponse, LlmUsage } from './llm'

const TOOL_NAME = 'write_lesson'
const DEFAULT_MAX_TOKENS = 32_000

export class LlmOutputError extends Error {
  constructor(
    message: string,
    /** Tokens the failed call still used (and cost). */
    readonly usage: LlmUsage,
  ) {
    super(message)
    this.name = 'LlmOutputError'
  }
}

export type Effort = 'low' | 'medium' | 'high'

/** Tool input schemas take plain JSON schema; only the `$schema` marker is dropped. */
function toolInputSchema(schema: Record<string, unknown>): Anthropic.Tool.InputSchema {
  return Object.fromEntries(
    Object.entries(schema).filter(([key]) => key !== '$schema'),
  ) as Anthropic.Tool.InputSchema
}

function expectsStructure(schema: unknown): boolean {
  if (!schema || typeof schema !== 'object') {
    return false
  }
  const { type, anyOf } = schema as { type?: unknown; anyOf?: unknown[] }
  return type === 'array' || type === 'object' || (anyOf ?? []).some(expectsStructure)
}

/**
 * With large tool inputs the model sometimes sends a nested array or object as a JSON string
 * (`"sections": "[{...}]"`). Parses those back where the schema expects structure; anything
 * that still does not fit is left for validateLesson to report.
 */
export function parseStringifiedFields(input: unknown, schema: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !schema) {
    return input
  }
  const properties = (schema as { properties?: Record<string, unknown> }).properties ?? {}
  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>).map(([key, value]) => {
      const propertySchema = properties[key]
      if (typeof value === 'string' && expectsStructure(propertySchema)) {
        try {
          return [key, JSON.parse(value) as unknown]
        } catch {
          return [key, value]
        }
      }
      return [key, parseStringifiedFields(value, propertySchema)]
    }),
  )
}

export function createAnthropicLlmClient({
  apiKey,
  effort = 'low',
}: {
  apiKey: string
  /** Thinking effort; lessons are mostly writing, so low keeps thinking tokens down (D-028). */
  effort?: Effort
}): LlmClient {
  const client = new Anthropic({ apiKey })
  return {
    async generateStructured(request: LlmRequest): Promise<LlmResponse> {
      const maxTokens = request.maxTokens ?? DEFAULT_MAX_TOKENS
      // Streaming keeps long generations clear of HTTP timeouts.
      const stream = client.messages.stream({
        model: request.model,
        max_tokens: maxTokens,
        system: `${request.system}\n\nDeliver the lesson by calling the ${TOOL_NAME} tool exactly once with the complete lesson body. Do not write anything else.`,
        messages: [{ role: 'user', content: request.prompt }],
        tools: [
          {
            name: TOOL_NAME,
            description: 'Saves the complete lesson body. Its input must match the schema exactly.',
            input_schema: toolInputSchema(request.schema),
          },
        ],
        tool_choice: { type: 'auto' },
        output_config: { effort },
      })
      const message = await stream.finalMessage()
      const usage: LlmUsage = {
        inputTokens:
          message.usage.input_tokens +
          (message.usage.cache_creation_input_tokens ?? 0) +
          (message.usage.cache_read_input_tokens ?? 0),
        outputTokens: message.usage.output_tokens,
      }
      if (message.stop_reason === 'refusal') {
        throw new LlmOutputError('The model declined to write this lesson', usage)
      }
      if (message.stop_reason === 'max_tokens') {
        throw new LlmOutputError(`Output hit the ${maxTokens} token limit`, usage)
      }
      const call = message.content.find(
        (block): block is Anthropic.ToolUseBlock =>
          block.type === 'tool_use' && block.name === TOOL_NAME,
      )
      if (!call) {
        throw new LlmOutputError(`The model did not call ${TOOL_NAME}`, usage)
      }
      return {
        output: parseStringifiedFields(call.input, request.schema),
        usage,
        model: message.model,
      }
    },
  }
}
