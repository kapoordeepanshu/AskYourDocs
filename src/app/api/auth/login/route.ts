import { sql } from 'drizzle-orm'
import { z } from 'zod'

import { HttpError, clientIp, json, parseJson, route } from '@/lib/api'
import { audit } from '@/lib/audit'
import { createSession, fakeVerify, setSessionCookie, verifyPassword } from '@/lib/auth'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'

const bodySchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
})

/** Deliberately identical for unknown email, wrong password, and disabled account. */
const REJECTION = 'Email or password is incorrect.'

export const POST = route(async (request: Request) => {
  const { email, password } = await parseJson(request, bodySchema)
  const ip = clientIp(request)

  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1)

  if (!user) {
    // Spend the same time we would have spent on a real hash so response
    // latency does not reveal whether the account exists.
    await fakeVerify()
    await audit({ action: 'user.login_failed', metadata: { email }, ipAddress: ip })
    throw new HttpError(401, REJECTION, 'invalid_credentials')
  }

  const ok = await verifyPassword(password, user.passwordHash)
  if (!ok || user.disabledAt) {
    await audit({
      actorId: user.id,
      action: 'user.login_failed',
      targetType: 'user',
      targetId: user.id,
      metadata: { reason: ok ? 'disabled' : 'bad_password' },
      ipAddress: ip,
    })
    throw new HttpError(401, REJECTION, 'invalid_credentials')
  }

  const { token, expiresAt } = await createSession(user.id)
  await setSessionCookie(token, expiresAt)

  await audit({
    actorId: user.id,
    action: 'user.login',
    targetType: 'user',
    targetId: user.id,
    ipAddress: ip,
  })

  return json({
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  })
})
