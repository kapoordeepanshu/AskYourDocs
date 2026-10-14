import { desc, eq } from 'drizzle-orm'

import { clientIp, json, parseJson, route } from '@/lib/api'
import { audit } from '@/lib/audit'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { widgets } from '@/lib/db/schema'
import { generatePublicKey } from '@/lib/widget'
import { ownedDocumentIds, widgetInputSchema } from '@/lib/widget/input'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = route(async () => {
  const user = await requireUser()

  const rows = await db
    .select()
    .from(widgets)
    .where(eq(widgets.ownerId, user.id))
    .orderBy(desc(widgets.createdAt))

  return json({ widgets: rows })
})

export const POST = route(async (request: Request) => {
  const user = await requireUser()
  const input = await parseJson(request, widgetInputSchema)

  const [created] = await db
    .insert(widgets)
    .values({
      ...input,
      ownerId: user.id,
      publicKey: generatePublicKey(),
      documentIds: await ownedDocumentIds(user.id, input.documentIds),
    })
    .returning()

  await audit({
    actorId: user.id,
    action: 'widget.created',
    targetType: 'widget',
    targetId: created.id,
    metadata: { name: created.name },
    ipAddress: clientIp(request),
  })

  return json({ widget: created }, { status: 201 })
})
