import { and, desc, eq, sql } from 'drizzle-orm'
import type { Metadata } from 'next'

import { WidgetsView, type WidgetSummary } from '@/components/widgets-view'
import { requirePageUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { documents, widgets } from '@/lib/db/schema'
import { env } from '@/lib/env'

export const metadata: Metadata = { title: 'Website widget' }
export const dynamic = 'force-dynamic'

/** Unanswered questions shown per widget. Enough to spot a gap, not a full log. */
const UNANSWERED_PER_WIDGET = 8

export default async function WidgetsPage() {
  const user = await requirePageUser('/widgets')

  const [widgetRows, documentRows, statRows, unansweredRows] = await Promise.all([
    db.select().from(widgets).where(eq(widgets.ownerId, user.id)).orderBy(desc(widgets.createdAt)),

    db
      .select({ id: documents.id, title: documents.title })
      .from(documents)
      .where(and(eq(documents.ownerId, user.id), eq(documents.status, 'ready')))
      .orderBy(documents.title)
      .limit(500),

    db.execute<{ widget_id: string; questions: number; unanswered: number }>(sql`
      select c.widget_id,
             count(*) filter (where m.role = 'user')::int                    as questions,
             count(*) filter (where m.role = 'assistant' and m.refused)::int as unanswered
      from messages m
      join conversations c on c.id = m.conversation_id
      where c.owner_id = ${user.id}
        and c.widget_id is not null
        and m.created_at > now() - interval '30 days'
      group by c.widget_id
    `),

    // A refusal is stored on the assistant message; the question it answered
    // is the user message just before it in the same conversation.
    db.execute<{ widget_id: string; question: string; asked_at: string }>(sql`
      select c.widget_id, q.content as question, a.created_at as asked_at
      from messages a
      join conversations c on c.id = a.conversation_id
      join lateral (
        select u.content from messages u
        where u.conversation_id = a.conversation_id
          and u.role = 'user'
          and u.created_at <= a.created_at
        order by u.created_at desc
        limit 1
      ) q on true
      where c.owner_id = ${user.id}
        and c.widget_id is not null
        and a.role = 'assistant'
        and a.refused
      order by a.created_at desc
      limit 200
    `),
  ])

  const stats = new Map(
    (statRows as unknown as { widget_id: string; questions: number; unanswered: number }[]).map(
      (row) => [row.widget_id, { questions: row.questions, unanswered: row.unanswered }],
    ),
  )

  const unanswered = new Map<string, { question: string; askedAt: string }[]>()
  for (const row of unansweredRows as unknown as {
    widget_id: string
    question: string
    asked_at: string | Date
  }[]) {
    const list = unanswered.get(row.widget_id) ?? []
    if (list.length < UNANSWERED_PER_WIDGET) {
      list.push({ question: row.question, askedAt: new Date(row.asked_at).toISOString() })
      unanswered.set(row.widget_id, list)
    }
  }

  const initial: WidgetSummary[] = widgetRows.map((widget) => ({
    id: widget.id,
    publicKey: widget.publicKey,
    name: widget.name,
    title: widget.title,
    greeting: widget.greeting,
    fallbackMessage: widget.fallbackMessage,
    accentColor: widget.accentColor,
    allowedOrigins: widget.allowedOrigins,
    documentIds: widget.documentIds,
    enabled: widget.enabled,
    questions30d: stats.get(widget.id)?.questions ?? 0,
    unanswered30d: stats.get(widget.id)?.unanswered ?? 0,
    recentUnanswered: unanswered.get(widget.id) ?? [],
  }))

  return (
    <WidgetsView
      widgets={initial}
      documents={documentRows}
      appUrl={env().APP_URL.replace(/\/$/, '')}
    />
  )
}
