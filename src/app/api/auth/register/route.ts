import { sql } from 'drizzle-orm'
import { z } from 'zod'

import { HttpError, clientIp, json, parseJson, route } from '@/lib/api'
import { audit } from '@/lib/audit'
import { createSession, hashPassword, setSessionCookie, validatePassword } from '@/lib/auth'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { env } from '@/lib/env'

const bodySchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  password: z.string(),
  name: z.string().trim().max(120).optional(),
})

export const POST = route(async (request: Request) => {
  const { email, password, name } = await parseJson(request, bodySchema)

  const passwordProblem = validatePassword(password)
  if (passwordProblem) {
    throw new HttpError(400, passwordProblem, 'bad_request', { password: passwordProblem })
  }

  // The very first account always becomes the admin, and is always allowed
  // through — otherwise a fresh instance with registration disabled would have
  // no way to create its first user.
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
  const isFirstUser = count === 0

  if (!isFirstUser && !env().ALLOW_PUBLIC_REGISTRATION) {
    throw new HttpError(
      403,
      'Registration is closed on this instance. Ask an administrator for an account.',
      'registration_closed',
    )
  }

  const passwordHash = await hashPassword(password)

  let userId: string
  try {
    const [created] = await db
      .insert(users)
      .values({
        email,
        passwordHash,
        name: name || null,
        role: isFirstUser ? 'admin' : 'member',
      })
      .returning({ id: users.id })
    userId = created.id
  } catch (error) {
    // Unique violation on the case-insensitive email index.
    if (error instanceof Error && 'code' in error && error.code === '23505') {
      throw new HttpError(409, 'An account with that email already exists.', 'email_taken', {
        email: 'An account with that email already exists.',
      })
    }
    throw error
  }

  const { token, expiresAt } = await createSession(userId)
  await setSessionCookie(token, expiresAt)

  await audit({
    actorId: userId,
    action: 'user.register',
    targetType: 'user',
    targetId: userId,
    metadata: { firstUser: isFirstUser },
    ipAddress: clientIp(request),
  })

  return json({
    user: { id: userId, email, name: name || null, role: isFirstUser ? 'admin' : 'member' },
  })
})
