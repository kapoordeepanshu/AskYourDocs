import { and, asc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

import { clientIp, json, notFound, route } from '@/lib/api'
import { audit } from '@/lib/audit'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { citations, conversations, documents, messages } from '@/lib/db/schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const paramsSchema = z.object({ id: z.string().uuid() })
type Context = { params: Promise<{ id: string }> }

export const GET = route(async (_request: Request, context: Context) => {
  const user = await requireUser()
  const { id } = paramsSchema.parse(await context.params)

  const [conversation] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.ownerId, user.id)))
    .limit(1)

  if (!conversation) throw notFound('That conversation does not exist.')

  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(asc(messages.createdAt))

  const assistantIds = rows.filter((m) => m.role === 'assistant').map((m) => m.id)

  // Citations are joined to documents so a stored answer can still name its
  // source, and left as-is when the document has since been deleted.
  const citationRows = assistantIds.length
    ? await db
        .select({
          messageId: citations.messageId,
          chunkId: citations.chunkId,
          documentId: citations.documentId,
          documentTitle: documents.title,
          sourceUrl: documents.sourceUrl,
          sentenceIndex: citations.sentenceIndex,
          sentence: citations.sentence,
          verdict: citations.verdict,
          verdictReason: citations.verdictReason,
        })
        .from(citations)
        .leftJoin(documents, eq(documents.id, citations.documentId))
        .where(inArray(citations.messageId, assistantIds))
    : []

  return json({
    conversation: { id: conversation.id, title: conversation.title },
    messages: rows.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      groundingScore: message.groundingScore,
      refused: message.refused,
      sources: message.sources ?? [],
      createdAt: message.createdAt,
      citations: citationRows.filter((c) => c.messageId === message.id),
    })),
  })
})

export const DELETE = route(async (request: Request, context: Context) => {
  const user = await requireUser()
  const { id } = paramsSchema.parse(await context.params)

  const [deleted] = await db
    .delete(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.ownerId, user.id)))
    .returning({ id: conversations.id })

  if (!deleted) throw notFound('That conversation does not exist.')

  await audit({
    actorId: user.id,
    action: 'conversation.deleted',
    targetType: 'conversation',
    targetId: deleted.id,
    ipAddress: clientIp(request),
  })

  return json({ ok: true })
})
