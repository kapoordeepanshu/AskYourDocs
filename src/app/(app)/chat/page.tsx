import type { Metadata } from 'next'

import { ChatView } from '@/components/chat-view'
import { requirePageUser } from '@/lib/auth'
import { loadChatShell } from '@/lib/chat-data'

export const metadata: Metadata = { title: 'Chat' }
export const dynamic = 'force-dynamic'

export default async function NewChatPage() {
  const user = await requirePageUser('/chat')
  const { conversations, hasDocuments } = await loadChatShell(user.id)

  return (
    <ChatView
      initialMessages={[]}
      conversations={conversations}
      hasDocuments={hasDocuments}
    />
  )
}
