import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { ChatView } from '@/components/chat-view'
import { requirePageUser } from '@/lib/auth'
import { loadChatShell, loadConversation } from '@/lib/chat-data'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const user = await requirePageUser()
  const conversation = await loadConversation(user.id, (await params).id)
  return { title: conversation?.title ?? 'Chat' }
}

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const user = await requirePageUser(`/chat/${id}`)

  const [shell, conversation] = await Promise.all([
    loadChatShell(user.id),
    loadConversation(user.id, id),
  ])

  // A conversation belonging to someone else is indistinguishable from one that
  // does not exist, which is the correct thing to leak: nothing.
  if (!conversation) notFound()

  return (
    <ChatView
      conversationId={id}
      initialMessages={conversation.messages}
      conversations={shell.conversations}
      hasDocuments={shell.hasDocuments}
    />
  )
}
