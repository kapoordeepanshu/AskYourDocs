import { and, asc, desc, eq, isNull } from 'drizzle-orm'

import { db } from '@/lib/db'
import { citations, conversations, messages } from '@/lib/db/schema'
import { env } from '@/lib/env'
import { getLlm, type ChatMessage } from '@/lib/llm'
import { parseSentences, stripCitations } from './citations'
import {
  MAX_HISTORY_TURNS,
  REFUSAL_TEXT,
  TITLE_SYSTEM,
  answerSystem,
  buildUserTurn,
  describeLocation,
} from './prompt'
import { hasUsableContext, retrieve, type RetrievedChunk } from './retrieve'
import { rerank } from './rerank'
import { verifyAnswer, type CitationCheck } from './verify'

export interface SourceRef {
  /** 1-based passage number, matching the [n] markers in the answer. */
  n: number
  chunkId: string
  documentId: string
  title: string
  location: string | null
  sourceUrl: string | null
  excerpt: string
}

export type AnswerEvent =
  | { type: 'status'; stage: 'retrieving' | 'reading' | 'writing' | 'checking' }
  | { type: 'meta'; conversationId: string; sources: SourceRef[] }
  | { type: 'delta'; text: string }
  | {
      type: 'done'
      messageId: string
      refused: boolean
      groundingScore: number | null
      uncitedCount: number
      checks: CitationCheck[]
    }
  | { type: 'error'; message: string }

function toSourceRefs(chunks: RetrievedChunk[]): SourceRef[] {
  return chunks.map((chunk, index) => ({
    n: index + 1,
    chunkId: chunk.chunkId,
    documentId: chunk.documentId,
    title: chunk.documentTitle,
    location: describeLocation(chunk),
    sourceUrl: chunk.sourceUrl,
    excerpt: chunk.content.slice(0, 320),
  }))
}

async function loadHistory(conversationId: string): Promise<ChatMessage[]> {
  const rows = await db
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(MAX_HISTORY_TURNS * 2)

  return rows.reverse().map((row) => ({
    role: row.role,
    // Citation markers are stripped from past answers. Each turn is given a
    // fresh set of passages, so a stale [3] in the history invites the model
    // to reuse a number that now points somewhere else entirely.
    content: row.role === 'assistant' ? stripCitations(row.content) : row.content,
  }))
}

/**
 * Runs one question end to end and yields events as they happen.
 *
 * Written as a generator so the route handler only has to serialise events,
 * and so the pipeline can be exercised in a test without an HTTP layer.
 */
export async function* answerQuestion(input: {
  ownerId: string
  question: string
  conversationId?: string
  documentIds?: string[]
  signal?: AbortSignal
  /**
   * Set when a website visitor is asking through an embedded widget. Scopes
   * the conversation to that widget, so a visitor can never continue one of
   * the owner's private conversations, or the reverse, by guessing an id.
   */
  widget?: { id: string; fallbackMessage: string }
}): AsyncGenerator<AnswerEvent> {
  const started = Date.now()
  const question = input.question.trim()
  const widgetId = input.widget?.id ?? null
  const refusalText = input.widget?.fallbackMessage ?? REFUSAL_TEXT

  // ── Conversation ────────────────────────────────────────────────────────
  let conversationId = input.conversationId
  if (conversationId) {
    const [existing] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.ownerId, input.ownerId),
          widgetId ? eq(conversations.widgetId, widgetId) : isNull(conversations.widgetId),
        ),
      )
      .limit(1)
    if (!existing) {
      yield { type: 'error', message: 'That conversation no longer exists.' }
      return
    }
  } else {
    const [created] = await db
      .insert(conversations)
      .values({ ownerId: input.ownerId, widgetId, title: question.slice(0, 80) })
      .returning({ id: conversations.id })
    conversationId = created.id
  }

  const history = await loadHistory(conversationId)

  await db.insert(messages).values({ conversationId, role: 'user', content: question })

  // ── Retrieval ───────────────────────────────────────────────────────────
  yield { type: 'status', stage: 'retrieving' }

  const candidates = await retrieve(input.ownerId, question, {
    documentIds: input.documentIds,
  })

  if (candidates.length === 0 || !hasUsableContext(candidates)) {
    // Nothing close enough to answer from. Refusing here is the feature, not a
    // failure: an answer built on passages this weak is exactly the confident,
    // well-cited, wrong answer this project exists to avoid.
    const [saved] = await db
      .insert(messages)
      .values({
        conversationId,
        role: 'assistant',
        content: refusalText,
        refused: true,
        latencyMs: Date.now() - started,
      })
      .returning({ id: messages.id })

    await touchConversation(conversationId)

    yield { type: 'meta', conversationId, sources: [] }
    yield { type: 'delta', text: refusalText }
    yield {
      type: 'done',
      messageId: saved.id,
      refused: true,
      groundingScore: null,
      uncitedCount: 0,
      checks: [],
    }
    return
  }

  yield { type: 'status', stage: 'reading' }
  const chunks = await rerank(question, candidates, env().RETRIEVAL_TOP_K)
  const sources = toSourceRefs(chunks)

  yield { type: 'meta', conversationId, sources }

  // ── Generation ──────────────────────────────────────────────────────────
  yield { type: 'status', stage: 'writing' }

  const llm = getLlm()
  const turns: ChatMessage[] = [...history, { role: 'user', content: buildUserTurn(question, chunks) }]

  let answer = ''
  try {
    for await (const delta of llm.stream(turns, {
      system: answerSystem(widgetId ? 'visitor' : 'owner'),
      temperature: 0,
      maxTokens: 1500,
      signal: input.signal,
    })) {
      answer += delta
      yield { type: 'delta', text: delta }
    }
  } catch (error) {
    yield {
      type: 'error',
      message: error instanceof Error ? error.message : 'The model failed to respond.',
    }
    return
  }

  if (!answer.trim()) {
    yield { type: 'error', message: 'The model returned an empty answer.' }
    return
  }

  // ── Verification ────────────────────────────────────────────────────────
  yield { type: 'status', stage: 'checking' }

  const sentences = parseSentences(answer)
  const verification = await verifyAnswer(sentences, chunks)

  const [saved] = await db
    .insert(messages)
    .values({
      conversationId,
      role: 'assistant',
      content: answer,
      groundingScore: verification.groundingScore,
      refused: false,
      sources,
      model: llm.model,
      latencyMs: Date.now() - started,
    })
    .returning({ id: messages.id })

  if (verification.checks.length > 0) {
    await db.insert(citations).values(
      verification.checks.map((check) => ({
        messageId: saved.id,
        chunkId: check.chunkId,
        documentId: check.documentId,
        sentenceIndex: check.sentenceIndex,
        sentence: check.sentence,
        retrievalScore:
          chunks[check.passage - 1]?.similarity?.toFixed(4) ?? null,
        verdict: check.verdict,
        verdictReason: check.reason,
      })),
    )
  }

  await touchConversation(conversationId)
  // Visitor conversations are never listed by title, so skip the extra call.
  if (!widgetId) void maybeTitle(conversationId, question)

  yield {
    type: 'done',
    messageId: saved.id,
    refused: false,
    groundingScore: verification.groundingScore,
    uncitedCount: verification.uncitedCount,
    checks: verification.checks,
  }
}

async function touchConversation(id: string): Promise<void> {
  await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, id))
}

/**
 * Names a conversation from its first question. Fire-and-forget: a failed
 * title is cosmetic, and making the user wait for it would add a round trip to
 * every first message.
 */
async function maybeTitle(conversationId: string, question: string): Promise<void> {
  try {
    const [first] = await db
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt))
      .limit(1)

    const [conversation] = await db
      .select({ title: conversations.title })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1)

    // Only rename while the title is still the raw first question.
    if (!first || !conversation || conversation.title !== question.slice(0, 80)) return

    const { text } = await getLlm().complete([{ role: 'user', content: question }], {
      system: TITLE_SYSTEM,
      temperature: 0,
      maxTokens: 30,
    })

    const title = text.trim().replace(/^["']|["']$/g, '').slice(0, 80)
    if (title) {
      await db.update(conversations).set({ title }).where(eq(conversations.id, conversationId))
    }
  } catch {
    /* the raw question remains the title */
  }
}
