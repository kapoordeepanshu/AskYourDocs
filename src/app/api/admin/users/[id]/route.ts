import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'

import { HttpError, clientIp, json, notFound, parseJson, route } from '@/lib/api'
import { audit } from '@/lib/audit'
import { destroyAllSessions, requireAdmin } from '@/lib/auth'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'

export const runtime = 'nodejs'

const paramsSchema = z.object({ id: z.string().uuid() })
const patchSchema = z.object({
  role: z.enum(['admin', 'member']).optional(),
  disabled: z.boolean().optional(),
})

type Context = { params: Promise<{ id: string }> }

/** Refuses to leave the instance with no way back in. */
async function assertNotLastAdmin(userId: string): Promise<void> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(sql`${users.role} = 'admin' and ${users.id} <> ${userId} and ${users.disabledAt} is null`)

  if (count === 0) {
    throw new HttpError(
      409,
      'This is the only active administrator. Promote someone else first.',
      'last_admin',
    )
  }
}

export const PATCH = route(async (request: Request, context: Context) => {
  const admin = await requireAdmin()
  const { id } = paramsSchema.parse(await context.params)
  const changes = await parseJson(request, patchSchema)

  const [target] = await db.select().from(users).where(eq(users.id, id)).limit(1)
  if (!target) throw notFound('That user does not exist.')

  // Demoting or disabling yourself is allowed, but not if it locks everyone out.
  if (changes.role === 'member' && target.role === 'admin') await assertNotLastAdmin(id)
  if (changes.disabled === true && target.role === 'admin') await assertNotLastAdmin(id)

  const patch: Partial<typeof users.$inferInsert> = {}
  if (changes.role !== undefined) patch.role = changes.role
  if (changes.disabled !== undefined) patch.disabledAt = changes.disabled ? new Date() : null

  if (Object.keys(patch).length === 0) return json({ ok: true })

  await db.update(users).set(patch).where(eq(users.id, id))

  // A disabled account must stop working immediately, not when its cookie
  // happens to expire.
  if (changes.disabled === true) await destroyAllSessions(id)

  if (changes.role !== undefined) {
    await audit({
      actorId: admin.id,
      action: 'user.role_changed',
      targetType: 'user',
      targetId: id,
      metadata: { from: target.role, to: changes.role },
      ipAddress: clientIp(request),
    })
  }
  if (changes.disabled !== undefined) {
    await audit({
      actorId: admin.id,
      action: changes.disabled ? 'user.disabled' : 'user.enabled',
      targetType: 'user',
      targetId: id,
      ipAddress: clientIp(request),
    })
  }

  return json({ ok: true })
})

export const DELETE = route(async (request: Request, context: Context) => {
  const admin = await requireAdmin()
  const { id } = paramsSchema.parse(await context.params)

  if (id === admin.id) {
    throw new HttpError(409, 'You cannot delete your own account.', 'self_delete')
  }

  const [target] = await db.select({ role: users.role, email: users.email }).from(users).where(eq(users.id, id)).limit(1)
  if (!target) throw notFound('That user does not exist.')
  if (target.role === 'admin') await assertNotLastAdmin(id)

  // Documents, chunks, conversations, and sessions cascade from this row.
  // Their stored originals are left for a future sweep rather than deleted
  // here, where a storage failure would abort a half-finished delete.
  await db.delete(users).where(eq(users.id, id))

  await audit({
    actorId: admin.id,
    action: 'user.deleted',
    targetType: 'user',
    targetId: id,
    metadata: { email: target.email },
    ipAddress: clientIp(request),
  })

  return json({ ok: true })
})

export const GET = route(async (_request: Request, context: Context) => {
  await requireAdmin()
  const { id } = paramsSchema.parse(await context.params)

  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      disabledAt: users.disabledAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1)

  if (!user) throw notFound('That user does not exist.')
  return json({ user })
})
