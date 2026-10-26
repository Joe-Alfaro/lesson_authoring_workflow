/**
 * Checks run by scripts/docker_smoke.sh against the three production containers: health, sign-in
 * through Auth.js, collab tokens from the web app and the collab server's token and document
 * checks at the collab URL the web app is configured with. Never calls the model.
 *
 * Env: SMOKE_WEB_URL, SMOKE_WORKER_URL, SMOKE_COLLAB_HTTP_URL, SMOKE_COLLAB_URL (the web
 * service's COLLAB_URL), SMOKE_SEED_PASSWORD.
 */
import { HocuspocusProvider } from '@hocuspocus/provider'
import * as Y from 'yjs'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is required`)
  }
  return value
}

const webUrl = requireEnv('SMOKE_WEB_URL')
const workerUrl = requireEnv('SMOKE_WORKER_URL')
const collabHttpUrl = requireEnv('SMOKE_COLLAB_HTTP_URL')
const collabUrl = requireEnv('SMOKE_COLLAB_URL')
const password = requireEnv('SMOKE_SEED_PASSWORD')

let failures = 0
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
  if (!ok) {
    failures += 1
  }
}

/** A tiny cookie jar: enough for Auth.js's csrf and session cookies. */
class Session {
  private cookies = new Map<string, string>()

  async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers)
    if (this.cookies.size > 0) {
      headers.set('cookie', [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '))
    }
    const response = await fetch(new URL(path, webUrl), { ...init, headers, redirect: 'manual' })
    for (const cookie of response.headers.getSetCookie()) {
      const [pair = ''] = cookie.split(';')
      const index = pair.indexOf('=')
      this.cookies.set(pair.slice(0, index), pair.slice(index + 1))
    }
    return response
  }

  async signIn(email: string, secret: string): Promise<boolean> {
    const csrf = (await (await this.fetch('/api/auth/csrf')).json()) as { csrfToken: string }
    await this.fetch('/api/auth/callback/credentials', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        email,
        password: secret,
        csrfToken: csrf.csrfToken,
        callbackUrl: `${webUrl}/units`,
      }),
    })
    const session = (await (await this.fetch('/api/auth/session')).json()) as {
      user?: { email?: string }
    } | null
    return session?.user?.email === email
  }

  async collabToken(): Promise<string> {
    const response = await this.fetch('/api/collab-token')
    const body = (await response.json()) as { token?: string }
    return body.token ?? ''
  }
}

type Outcome = 'synced' | 'denied' | 'timeout'

function openDocument(name: string, token: string) {
  const document = new Y.Doc()
  let provider: HocuspocusProvider | undefined
  const outcome = new Promise<Outcome>((resolve) => {
    const timer = setTimeout(() => resolve('timeout'), 10_000)
    provider = new HocuspocusProvider({
      url: collabUrl,
      name,
      document,
      token,
      onSynced: () => {
        clearTimeout(timer)
        resolve('synced')
      },
      onAuthenticationFailed: () => {
        clearTimeout(timer)
        resolve('denied')
      },
    })
  })
  return { document, outcome, close: () => provider?.destroy() }
}

for (const [name, url] of [
  ['web', webUrl],
  ['worker', workerUrl],
  ['collab', collabHttpUrl],
] as const) {
  const response = await fetch(new URL('/health', url))
  check(`${name} GET /health is 200`, response.status === 200, `got ${response.status}`)
}

const anonymous = new Session()
const home = await anonymous.fetch('/units')
check(
  'signed-out page redirects to sign-in',
  home.status === 307 && (home.headers.get('location') ?? '').includes('/sign-in'),
  `got ${home.status}`,
)
check('signed-out collab token is 401', (await anonymous.fetch('/api/collab-token')).status === 401)
check(
  'wrong password does not sign in',
  !(await new Session().signIn('author01@example.com', `${password}-wrong`)),
)

check(
  'the README demo password does not sign in',
  !(await new Session().signIn('admin@example.com', 'demo-password')),
)

const author = new Session()
const reviewer = new Session()
check('author signs in with SEED_PASSWORD', await author.signIn('author01@example.com', password))
check('reviewer signs in', await reviewer.signIn('reviewer01@example.com', password))
const authorToken = await author.collabToken()
const reviewerToken = await reviewer.collabToken()
check('web issues collab tokens', authorToken.length > 0 && reviewerToken.length > 0)

const documentName = `smoke-${Date.now()}`
const denied = openDocument(documentName, 'not-a-token')
check(`collab rejects a bad token at ${collabUrl}`, (await denied.outcome) === 'denied')
denied.close()

// Collab serves lesson documents only (M3); the browser flow (docker_smoke_flow.ts) co-edits one.
const unknown = openDocument(documentName, authorToken)
check(
  'collab refuses a valid token for a document that is not a lesson',
  (await unknown.outcome) === 'denied',
)
unknown.close()

console.log(failures === 0 ? 'All smoke checks passed' : `${failures} smoke check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
