import { Database as DatabaseExtension } from '@hocuspocus/extension-database'
import { Server } from '@hocuspocus/server'
import { createDb, createPool } from '../db/client'
import { handleHealthRequest } from '../health/server'
import { authenticateConnection, type CollabContext } from './authenticate'
import { createYjsPersistence } from './persistence'

export interface CollabOptions {
  databaseUrl: string
  port: number
  /** AUTH_SECRET shared with the web app, which signs the collab tokens. */
  authSecret: string
}

export interface RunningCollab {
  url: string
  stop(): Promise<void>
}

export async function startCollabServer(options: CollabOptions): Promise<RunningCollab> {
  const pool = createPool(options.databaseUrl)
  const persistence = createYjsPersistence(createDb(pool))

  const server = new Server<CollabContext>({
    port: options.port,
    quiet: true,
    stopOnSignals: false,
    extensions: [
      new DatabaseExtension({
        fetch: ({ documentName }) => persistence.fetch(documentName),
        store: ({ documentName, state }) => persistence.store(documentName, state),
      }),
    ],
    async onAuthenticate({ token }) {
      // R27. Per-document checks (approved lessons, assignment) build on context.user in M3/M4.
      return authenticateConnection(token, options.authSecret)
    },
    async onRequest({ request, response }) {
      if (await handleHealthRequest(pool, request, response)) {
        // Hocuspocus stops its default response when the hook rejects with a falsy value.
        return Promise.reject(null)
      }
    },
  })

  await server.listen()

  return {
    url: `http://localhost:${server.address.port}`,
    async stop() {
      await server.destroy()
      await pool.end()
    },
  }
}
