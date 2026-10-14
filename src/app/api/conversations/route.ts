import { and, desc, eq, isNull } from 'drizzle-orm'

import { json, route } from '@/lib/api'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { conversations } from '@/lib/db/schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = route(async () => {
  const user = await requireUser()

  const rows = await db
    .select({
      id: conversations.id,
      title: conversations.title,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    // Website visitors' conversations are reviewed from the widgets page instead.
    .where(and(eq(conversations.ownerId, user.id), isNull(conversations.widgetId)))
    .orderBy(desc(conversations.updatedAt))
    .limit(200)

  return json({ conversations: rows })
})
