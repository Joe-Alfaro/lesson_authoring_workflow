'use client'
// The lesson's collab connection (R18): a Hocuspocus provider on `lesson:<id>` with a fresh token
// per (re)connect (D-021), presence, save state and the flush message (src/editor/README.md).
import { HocuspocusProvider } from '@hocuspocus/provider'
import { useEffect, useMemo, useState } from 'react'
import * as Y from 'yjs'
import { lessonDocumentName } from '../../editor/document_name'
import { avatarColour, COLLABORATOR_HEX } from '../people'

export interface CollabUser {
  id: string
  name: string
}

export interface Collaborator extends CollabUser {
  colour: string
}

export type SaveState = 'connecting' | 'saving' | 'saved' | 'offline'

export interface LessonCollab {
  provider: HocuspocusProvider | null
  doc: Y.Doc
  synced: boolean
  saveState: SaveState
  /** Other people with the lesson open (one entry per person). */
  others: Collaborator[]
  /** Asks the server to store the latest edits now; resolves with its answer. */
  flush(): Promise<{ ok: boolean; reason?: string }>
}

const FLUSH_TIMEOUT_MS = 5_000

async function fetchToken(): Promise<string> {
  const response = await fetch('/api/collab-token', { cache: 'no-store' })
  if (!response.ok) throw new Error('Could not get a collab token')
  const body = (await response.json()) as { token: string }
  return body.token
}

export function userColour(id: string): string {
  return COLLABORATOR_HEX[avatarColour(id)]
}

export function useLessonCollab(lessonId: string, url: string, user: CollabUser): LessonCollab {
  const doc = useMemo(() => new Y.Doc(), [])
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null)
  const [synced, setSynced] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('connecting')
  const [others, setOthers] = useState<Collaborator[]>([])

  useEffect(() => {
    const next = new HocuspocusProvider({
      url,
      name: lessonDocumentName(lessonId),
      document: doc,
      token: fetchToken,
    })
    let connected = false
    const updateSave = () => {
      if (!connected) setSaveState(next.synced ? 'offline' : 'connecting')
      else if (!next.synced || next.hasUnsyncedChanges) setSaveState('saving')
      else setSaveState('saved')
    }
    const updatePresence = () => {
      const people = new Map<string, Collaborator>()
      next.awareness?.getStates().forEach((state, clientId) => {
        const person = state.user as (CollabUser & { color?: string }) | undefined
        if (!person || clientId === doc.clientID || person.id === user.id) return
        people.set(person.id, { id: person.id, name: person.name, colour: userColour(person.id) })
      })
      setOthers([...people.values()].sort((a, b) => a.name.localeCompare(b.name)))
    }
    next.on('synced', () => {
      setProvider(next)
      setSynced(true)
      updateSave()
    })
    next.on('status', ({ status }: { status: string }) => {
      connected = status === 'connected'
      updateSave()
    })
    next.on('unsyncedChanges', updateSave)
    next.on('awarenessChange', updatePresence)
    next.setAwarenessField('user', { id: user.id, name: user.name, color: userColour(user.id) })
    return () => {
      next.destroy()
      setProvider(null)
      setSynced(false)
    }
  }, [doc, lessonId, url, user.id, user.name])

  return {
    provider,
    doc,
    synced,
    saveState,
    others,
    flush() {
      const current = provider
      if (!current) return Promise.resolve({ ok: false, reason: 'offline' })
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          current.off('stateless', onStateless)
          resolve({ ok: false, reason: 'timeout' })
        }, FLUSH_TIMEOUT_MS)
        function onStateless({ payload }: { payload: string }) {
          const message = JSON.parse(payload) as { type?: string; ok?: boolean; reason?: string }
          if (message.type !== 'flushed') return
          clearTimeout(timer)
          current!.off('stateless', onStateless)
          resolve({ ok: Boolean(message.ok), reason: message.reason })
        }
        current.on('stateless', onStateless)
        current.sendStateless(JSON.stringify({ type: 'flush' }))
      })
    },
  }
}
