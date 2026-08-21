import { redirect } from 'next/navigation'

import { getCurrentUser, type SessionUser } from './session'

export * from './session'
export * from './password'

/**
 * Thrown by the route-handler guards. Converted to a response by
 * `apiError` in @/lib/api so handlers stay free of try/catch noise.
 */
export class AuthError extends Error {
  constructor(
    readonly status: 401 | 403,
    message: string,
  ) {
    super(message)
    this.name = 'AuthError'
  }
}

/** For server components. Redirects to login, preserving where they were going. */
export async function requirePageUser(returnTo?: string): Promise<SessionUser> {
  const user = await getCurrentUser()
  if (!user) {
    const target = returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : '/login'
    redirect(target)
  }
  return user
}

export async function requirePageAdmin(): Promise<SessionUser> {
  const user = await requirePageUser('/admin')
  if (user.role !== 'admin') redirect('/documents')
  return user
}

/** For route handlers. Throws rather than redirecting, since callers want JSON. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser()
  if (!user) throw new AuthError(401, 'Sign in to continue.')
  return user
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser()
  if (user.role !== 'admin') throw new AuthError(403, 'Administrator access required.')
  return user
}
