// Anthropic implementation of LlmClient (R7). Only src/worker constructs it; tests use a fake.
//
// The lesson schema is too large for constrained decoding (structured outputs reject it: too
// many optional properties, then "compiled grammar is too large"), and as tool input the model
// sometimes sends the nested `sections` array as a malformed JSON string. So the schema goes in
// the system prompt and the model answers with the JSON object as text; validateLesson in the
// worker is the gate and drives the repair retry (D-028).
import Anthropic from '@anthropic-ai/sdk'
import type { LlmClient, LlmRequest, LlmResponse, LlmUsage } from './llm'

const DEFAULT_MAX_TOKENS = 64_000

export type Effort = 'low' | 'medium' | 'high'

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

function jsonInstructions(schema: Record<string, unknown>): string {
  const { $schema: _marker, ...rest } = schema
  void _marker
  return `# Output format

Answer with one JSON object and nothing else: no Markdown fences, no commentary. It must match this JSON schema exactly (every "required" field present, arrays as arrays, no extra fields):

${JSON.stringify(rest)}`
}

/** The JSON object in a text answer, tolerating a Markdown fence or stray text around it. */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end < start) {
    throw new SyntaxError('no JSON object in the answer')
  }
  return JSON.parse(text.slice(start, end + 1))
}

export function createAnthropicLlmClient({
  apiKey,
  effort = 'medium',
}: {
  apiKey: string
  /** Thinking effort; medium gave valid lessons on the first attempt in the smoke run (D-028). */
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
        system: `${request.system}\n\n${jsonInstructions(request.schema)}`,
        messages: [{ role: 'user', content: request.prompt }],
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
      const text = message.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('')
      try {
        return { output: extractJson(text), usage, model: message.model }
      } catch (error) {
        throw new LlmOutputError(
          `The answer was not valid JSON (${(error as Error).message}); return one complete JSON object`,
          usage,
        )
      }
    },
  }
}
