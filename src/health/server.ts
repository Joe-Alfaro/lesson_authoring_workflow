import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type pg from 'pg'
import { checkHealth, healthStatusCode } from '../db/health'

/** Answers GET /health with the database check. Returns false for any other request. */
export async function handleHealthRequest(
  pool: pg.Pool,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<boolean> {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname
  if (request.method !== 'GET' || path !== '/health') {
    return false
  }
  const report = await checkHealth(pool)
  response.writeHead(healthStatusCode(report), { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(report))
  return true
}

/** A minimal HTTP server for processes that serve nothing but a health check. */
export function createHealthServer(pool: pg.Pool): Server {
  return createServer((request, response) => {
    handleHealthRequest(pool, request, response)
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
