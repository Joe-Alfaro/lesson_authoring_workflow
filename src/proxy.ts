import { NextResponse } from 'next/server'
import { decideAccess } from './auth/access'
import { auth } from './auth/auth'

export const proxy = auth((request) => {
  const decision = decideAccess(request.nextUrl.pathname, Boolean(request.auth?.user))
  if (decision === 'unauthorized') {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  }
  if (decision === 'redirect') {
    const url = new URL('/sign-in', request.nextUrl)
    url.searchParams.set('callbackUrl', `${request.nextUrl.pathname}${request.nextUrl.search}`)
    return NextResponse.redirect(url)
  }
  return NextResponse.next()
})

export const config = {
  // Everything except Next.js internals and static files.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
