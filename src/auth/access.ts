export type AccessDecision = 'allow' | 'redirect' | 'unauthorized'

const PUBLIC_PATHS = ['/sign-in', '/health']
const PUBLIC_PREFIXES = ['/api/auth/']

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.includes(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))
}

/**
 * R27: signed-out visitors are sent to sign-in. API routes answer 401 instead of a redirect so
 * fetch callers see the failure rather than the sign-in page's HTML.
 */
export function decideAccess(pathname: string, signedIn: boolean): AccessDecision {
  if (signedIn || isPublicPath(pathname)) {
    return 'allow'
  }
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    return 'unauthorized'
  }
  return 'redirect'
}
