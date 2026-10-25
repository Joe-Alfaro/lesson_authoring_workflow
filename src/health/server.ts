import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type pg from 'pg'
import { checkHealth, healthStatusCode } from '../db/health'

/** Reports whether the process itself has finished starting (e.g. its queue is running). */
export type ReadinessCheck = () => boolean

/**
 * Answers GET /health: 200 only when the database answers and the process is ready. Returns
 * false for any other request.
 */
export async function handleHealthRequest(
  pool: pg.Pool,
  request: IncomingMessage,
  response: ServerResponse,
  isReady: ReadinessCheck = () => true,
): Promise<boolean> {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname
  if (request.method !== 'GET' || path !== '/health') {
    return false
  }
  const report = await checkHealth(pool)
  const status = isReady() ? healthStatusCode(report) : 503
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(report))
  return true
}

/** A minimal HTTP server for processes that serve nothing but a health check. */
export function createHealthServer(pool: pg.Pool, isReady?: ReadinessCheck): Server {
  return createServer((request, response) => {
    handleHealthRequest(pool, request, response, isReady)
      .then((handled) => {
        if (!handled) {
          response.writeHead(404).end()
        }
      })
      .catch(() => {
        response.writeHead(500).end()
      })
  })
}
