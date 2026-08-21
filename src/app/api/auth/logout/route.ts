import { clientIp, json, route } from '@/lib/api'
import { audit } from '@/lib/audit'
import { destroyCurrentSession, getCurrentUser } from '@/lib/auth'

export const POST = route(async (request: Request) => {
  const user = await getCurrentUser()
  await destroyCurrentSession()

  if (user) {
    await audit({
      actorId: user.id,
      action: 'user.logout',
      targetType: 'user',
      targetId: user.id,
      ipAddress: clientIp(request),
    })
  }

  // Already signed out is a success, not an error.
  return json({ ok: true })
})
