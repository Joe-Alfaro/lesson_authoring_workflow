// A fake Anthropic Messages API for the e2e run (M4 AI assist, R20-R22). The app under test keeps
// its real Anthropic adapter; server.ts points it here with ANTHROPIC_BASE_URL, so no test ever
// reaches a real model and the app needs no test-only code path.
//
// Specs script the answers over HTTP (they run in another process than server.ts):
//   POST /__fake/responses { responses: FakeResponse[] }  queue answers, served in order
//   GET  /__fake/requests                                 every request received, oldest first
//   POST /__fake/reset                                    clear the queue and the request log
// A request with nothing queued gets a 400 invalid_request_error (not retried by the SDK), so a
// spec that forgot to script an answer fails loudly instead of hanging.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

export interface FakeResponse {
  /** The JSON object the model "answers" (sent as the text of the reply). */
  output: unknown
  /** Simulated latency before the answer starts. */
  delayMs?: number
  usage?: { inputTokens: number; outputTokens: number }
}

export interface FakeRequest {
  model: string
  system: string
  prompt: string
  receivedAt: string
}

/** 1000 + 1000 tokens: a fraction of a cent on a Haiku-class model. */
const DEFAULT_USAGE = { inputTokens: 1000, outputTokens: 1000 }

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === 'object' && 'text' in part ? String(part.text) : ''))
      .join('')
  }
  return ''
}

function sse(response: ServerResponse, event: string, data: unknown) {
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

export async function startFakeAnthropic(port: number): Promise<{ stop(): Promise<void> }> {
  let queue: FakeResponse[] = []
  let requests: FakeRequest[] = []
  let counter = 0

  async function messages(request: IncomingMessage, response: ServerResponse) {
    const body = JSON.parse(await readBody(request)) as {
      model: string
      system?: unknown
      messages?: { content: unknown }[]
      stream?: boolean
    }
    requests.push({
      model: body.model,
      system: textOf(body.system),
      prompt: (body.messages ?? []).map((message) => textOf(message.content)).join('\n'),
      receivedAt: new Date().toISOString(),
    })
    const next = queue.shift()
    if (!next) {
      sendJson(response, 400, {
        type: 'error',
        error: { type: 'invalid_request_error', message: 'fake Anthropic: no scripted response' },
      })
      return
    }
    if (next.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, next.delayMs))
    }
    if (response.destroyed) return

    const usage = next.usage ?? DEFAULT_USAGE
    const text = JSON.stringify(next.output)
    counter += 1
    const message = {
      id: `msg_fake_${counter}`,
      type: 'message',
      role: 'assistant',
      model: body.model,
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens },
    }
    if (!body.stream) {
      sendJson(response, 200, message)
      return
    }
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    sse(response, 'message_start', {
      type: 'message_start',
      message: {
        ...message,
        content: [],
        stop_reason: null,
        usage: { input_tokens: usage.inputTokens, output_tokens: 1 },
      },
    })
    sse(response, 'content_block_start', {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    })
    sse(response, 'content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text },
    })
    sse(response, 'content_block_stop', { type: 'content_block_stop', index: 0 })
    sse(response, 'message_delta', {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: usage.outputTokens },
    })
    sse(response, 'message_stop', { type: 'message_stop' })
    response.end()
  }

  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    void (async () => {
      try {
        if (request.method === 'POST' && url.pathname === '/v1/messages') {
          await messages(request, response)
        } else if (request.method === 'POST' && url.pathname === '/__fake/responses') {
          const body = JSON.parse(await readBody(request)) as { responses: FakeResponse[] }
          queue.push(...body.responses)
          sendJson(response, 200, { queued: queue.length })
        } else if (request.method === 'GET' && url.pathname === '/__fake/requests') {
          sendJson(response, 200, { requests })
        } else if (request.method === 'POST' && url.pathname === '/__fake/reset') {
          queue = []
          requests = []
          sendJson(response, 200, { ok: true })
        } else {
          sendJson(response, 404, { error: 'not found' })
        }
      } catch (error) {
        sendJson(response, 500, { error: (error as Error).message })
      }
    })()
  })

  await new Promise<void>((resolve) => server.listen(port, resolve))
  return {
    stop: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
