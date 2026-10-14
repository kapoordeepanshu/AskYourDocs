import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import { clientIp, json, notFound, parseJson, route } from '@/lib/api'
import { audit } from '@/lib/audit'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { widgets } from '@/lib/db/schema'
import { ownedDocumentIds, widgetInputSchema } from '@/lib/widget/input'

export const runtime = 'nodejs'

const paramsSchema = z.object({ id: z.string().uuid() })

type Context = { params: Promise<{ id: string }> }

export const PATCH = route(async (request: Request, context: Context) => {
  const user = await requireUser()
  const { id } = paramsSchema.parse(await context.params)
  const input = await parseJson(request, widgetInputSchema)

  const [updated] = await db
    .update(widgets)
    .set({
      ...input,
      documentIds: await ownedDocumentIds(user.id, input.documentIds),
      updatedAt: new Date(),
    })
    .where(and(eq(widgets.id, id), eq(widgets.ownerId, user.id)))
    .returning()

  if (!updated) throw notFound('That widget does not exist.')

  await audit({
    actorId: user.id,
    action: 'widget.updated',
    targetType: 'widget',
    targetId: updated.id,
    metadata: { name: updated.name, enabled: updated.enabled },
    ipAddress: clientIp(request),
  })

  return json({ widget: updated })
})

/** Visitor conversations cascade with the widget. */
export const DELETE = route(async (request: Request, context: Context) => {
  const user = await requireUser()
  const { id } = paramsSchema.parse(await context.params)

  const [deleted] = await db
    .delete(widgets)
    .where(and(eq(widgets.id, id), eq(widgets.ownerId, user.id)))
    .returning({ id: widgets.id, name: widgets.name })

  if (!deleted) throw notFound('That widget does not exist.')

  await audit({
    actorId: user.id,
    action: 'widget.deleted',
    targetType: 'widget',
    targetId: deleted.id,
    metadata: { name: deleted.name },
    ipAddress: clientIp(request),
  })

  return json({ ok: true })
})
