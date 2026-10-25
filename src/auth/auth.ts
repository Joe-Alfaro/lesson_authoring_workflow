import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { z } from 'zod'
import { getDb } from '../db/client'
import { verifyCredentials } from './credentials'
import { isRole } from './roles'

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Railway and local dev sit behind hosts Auth.js can't know in advance.
  trustHost: true,
  session: { strategy: 'jwt' },
  pages: { signIn: '/sign-in' },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw)
        if (!parsed.success) {
          return null
        }
        return verifyCredentials(getDb(), parsed.data.email, parsed.data.password)
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.sub = user.id
        token.role = user.role
      }
      return token
    },
    session({ session, token }) {
      if (token.sub) {
        session.user.id = token.sub
      }
      if (isRole(token.role)) {
        session.user.role = token.role
      }
      return session
    },
  },
})
