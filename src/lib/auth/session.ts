import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

import { eq, lt } from 'drizzle-orm'
import { cookies } from 'next/headers'

import { db } from '@/lib/db'
import { sessions, users, type User } from '@/lib/db/schema'
import { env } from '@/lib/env'

export const SESSION_COOKIE = 'ayd_session'

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
/** Slide the expiry once a session is more than halfway through its life. */
const RENEW_AFTER_MS = SESSION_TTL_MS / 2

/**
 * The cookie holds the raw token; the database holds only its SHA-256. A dump
 * of the sessions table therefore cannot be replayed as a live login.
 *
 * SHA-256 without a salt is correct here: the token is 256 bits of CSPRNG
 * output, so there is no dictionary to attack and we need the digest to be
 * deterministic for the index lookup.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export interface SessionUser {
  id: string
  email: string
  name: string | null
  role: 'admin' | 'member'
}

function toSessionUser(user: User): SessionUser {
  return { id: user.id, email: user.email, name: user.name, role: user.role }
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)

  await db.insert(sessions).values({ id: hashToken(token), userId, expiresAt })

  return { token, expiresAt }
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies()
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env().APP_URL.startsWith('https://'),
    path: '/',
    expires: expiresAt,
  })
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies()
  store.delete(SESSION_COOKIE)
}

/**
 * Resolves the current user, or null. Safe to call from any server component
 * or route handler.
 *
 * Deliberately not implemented as Next.js middleware: middleware runs on the
 * edge runtime, which cannot open a Postgres connection. Doing the lookup here
 * means one query per request against an indexed primary key.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (!token) return null

  const id = hashToken(token)
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, id))
    .limit(1)

  if (!row) return null

  if (row.session.expiresAt.getTime() <= Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, id))
    return null
  }

  // A disabled account keeps its sessions rows but stops authenticating, so an
  // admin can disable someone without waiting for their cookie to expire.
  if (row.user.disabledAt) return null

  const remaining = row.session.expiresAt.getTime() - Date.now()
  if (remaining < RENEW_AFTER_MS) {
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
    await db.update(sessions).set({ expiresAt }).where(eq(sessions.id, id))
    // The cookie itself is refreshed opportunistically; failing here (for
    // example in a server component that already streamed headers) must not
    // break the request.
    try {
      await setSessionCookie(token, expiresAt)
    } catch {
      /* headers already sent */
    }
  }

  return toSessionUser(row.user)
}

export async function destroyCurrentSession(): Promise<void> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (token) await db.delete(sessions).where(eq(sessions.id, hashToken(token)))
  await clearSessionCookie()
}

/** Invalidate every session for a user. Used on password change and by admins. */
export async function destroyAllSessions(userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId))
}

/** Called by the worker on a timer; expired rows are dead weight otherwise. */
export async function pruneExpiredSessions(): Promise<number> {
  const deleted = await db.delete(sessions).where(lt(sessions.expiresAt, new Date())).returning({
    id: sessions.id,
  })
  return deleted.length
}

/** Constant-time compare for CSRF-style token checks. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}
