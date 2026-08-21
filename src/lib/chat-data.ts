import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'

import type { ChatMessageView, ConversationSummary } from '@/components/chat-view'
import { db } from '@/lib/db'
import { citations, conversations, documents, messages } from '@/lib/db/schema'

/** Shared by the new-conversation and existing-conversation pages. */
export async function loadChatShell(ownerId: string): Promise<{
  conversations: ConversationSummary[]
  hasDocuments: boolean
}> {
  const [list, [ready]] = await Promise.all([
    db
      .select({
        id: conversations.id,
        title: conversations.title,
        updatedAt: conversations.updatedAt,
      })
      .from(conversations)
      .where(eq(conversations.ownerId, ownerId))
      .orderBy(desc(conversations.updatedAt))
      .limit(100),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(documents)
      .where(and(eq(documents.ownerId, ownerId), eq(documents.status, 'ready'))),
  ])

  return {
    conversations: list.map((c) => ({
      id: c.id,
      title: c.title,
      updatedAt: c.updatedAt.toISOString(),
    })),
    hasDocuments: ready.count > 0,
  }
}

/** Returns null when the conversation does not exist or belongs to someone else. */
export async function loadConversation(
  ownerId: string,
  conversationId: string,
): Promise<{ title: string; messages: ChatMessageView[] } | null> {
  const [conversation] = await db
    .select({ id: conversations.id, title: conversations.title })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.ownerId, ownerId)))
    .limit(1)

  if (!conversation) return null

  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt))

  const assistantIds = rows.filter((m) => m.role === 'assistant').map((m) => m.id)

  const verdictRows = assistantIds.length
    ? await db
        .select({
          messageId: citations.messageId,
          sentenceIndex: citations.sentenceIndex,
          verdict: citations.verdict,
          verdictReason: citations.verdictReason,
        })
        .from(citations)
        .where(inArray(citations.messageId, assistantIds))
    : []

  return {
    title: conversation.title,
    messages: rows.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      groundingScore: message.groundingScore,
      refused: message.refused,
      // Snapshotted at generation time, so the [n] markers still line up even
      // after the document has been re-indexed.
      sources: message.sources ?? [],
      verdicts: verdictRows
        .filter((v) => v.messageId === message.id)
        .map((v) => ({
          sentenceIndex: v.sentenceIndex,
          verdict: v.verdict,
          reason: v.verdictReason,
        })),
    })),
  }
}
