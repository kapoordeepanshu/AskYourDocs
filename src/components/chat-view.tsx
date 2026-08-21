'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

import { AnswerBody, type SentenceVerdict, type SourceRef } from '@/components/answer-body'
import type { ApiErrorBody } from '@/lib/api'

export interface ChatMessageView {
  id: string
  role: 'user' | 'assistant'
  content: string
  groundingScore: number | null
  refused: boolean
  sources: SourceRef[]
  verdicts: SentenceVerdict[]
}

export interface ConversationSummary {
  id: string
  title: string
  updatedAt: string
}

const STATUS_TEXT = {
  retrieving: 'Searching your documents',
  reading: 'Reading the best matches',
  writing: 'Writing the answer',
  checking: 'Checking every citation',
} as const

type Stage = keyof typeof STATUS_TEXT

export function ChatView({
  conversationId,
  initialMessages,
  conversations,
  hasDocuments,
}: {
  conversationId?: string
  initialMessages: ChatMessageView[]
  conversations: ConversationSummary[]
  hasDocuments: boolean
}) {
  const router = useRouter()
  const [messages, setMessages] = useState<ChatMessageView[]>(initialMessages)
  const [draft, setDraft] = useState('')
  const [stage, setStage] = useState<Stage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [streamingId, setStreamingId] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const activeId = useRef(conversationId)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, stage])

  // Abandoning a page mid-answer should stop the request, not leave it running.
  useEffect(() => () => abortRef.current?.abort(), [])

  const send = useCallback(
    async (question: string) => {
      setError(null)
      setDraft('')

      const pendingId = `pending-${Date.now()}`
      setMessages((prev) => [
        ...prev,
        {
          id: `${pendingId}-q`,
          role: 'user',
          content: question,
          groundingScore: null,
          refused: false,
          sources: [],
          verdicts: [],
        },
        {
          id: pendingId,
          role: 'assistant',
          content: '',
          groundingScore: null,
          refused: false,
          sources: [],
          verdicts: [],
        },
      ])
      setStreamingId(pendingId)

      const controller = new AbortController()
      abortRef.current = controller

      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ question, conversationId: activeId.current }),
          signal: controller.signal,
        })

        if (!response.ok || !response.body) {
          const body = (await response.json().catch(() => null)) as ApiErrorBody | null
          throw new Error(body?.error.message ?? 'The request failed.')
        }

        await readEventStream(response.body, (event) => {
          switch (event.type) {
            case 'status':
              setStage(event.stage)
              break

            case 'meta':
              activeId.current = event.conversationId
              setMessages((prev) =>
                prev.map((m) => (m.id === pendingId ? { ...m, sources: event.sources } : m)),
              )
              break

            case 'delta':
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === pendingId ? { ...m, content: m.content + event.text } : m,
                ),
              )
              break

            case 'done':
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === pendingId
                    ? {
                        ...m,
                        id: event.messageId,
                        groundingScore: event.groundingScore,
                        refused: event.refused,
                        verdicts: event.checks.map((c) => ({
                          sentenceIndex: c.sentenceIndex,
                          verdict: c.verdict,
                          reason: c.reason,
                        })),
                      }
                    : m,
                ),
              )
              break

            case 'error':
              setError(event.message)
              break
          }
        })

        // A brand-new conversation needs a real URL so it survives a reload.
        if (!conversationId && activeId.current) {
          router.replace(`/chat/${activeId.current}`)
          router.refresh()
        }
      } catch (caught) {
        if (controller.signal.aborted) return
        setError(caught instanceof Error ? caught.message : 'Something went wrong.')
        setMessages((prev) => prev.filter((m) => m.id !== pendingId))
      } finally {
        setStage(null)
        setStreamingId(null)
        abortRef.current = null
      }
    },
    [conversationId, router],
  )

  const busy = stage !== null

  return (
    <div className="flex h-dvh flex-col md:flex-row">
      <ConversationList conversations={conversations} activeId={conversationId} />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
            {messages.length === 0 ? (
              <EmptyState hasDocuments={hasDocuments} onPick={send} />
            ) : (
              <ul className="space-y-6">
                {messages.map((message) => (
                  <li key={message.id}>
                    {message.role === 'user' ? (
                      <div className="flex justify-end">
                        <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-accent px-4 py-2.5 text-[15px] text-accent-fg">
                          {message.content}
                        </p>
                      </div>
                    ) : (
                      <AssistantMessage
                        message={message}
                        streaming={message.id === streamingId}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}

            {busy && (
              <p className="animate-thinking mt-4 text-sm text-muted">{STATUS_TEXT[stage]}…</p>
            )}

            {error && (
              <div
                role="alert"
                className="mt-4 rounded-lg border border-border bg-danger-soft px-3 py-2 text-sm text-danger"
              >
                {error}
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        </div>

        <Composer
          value={draft}
          onChange={setDraft}
          onSubmit={send}
          disabled={busy}
          hasDocuments={hasDocuments}
        />
      </div>
    </div>
  )
}

function AssistantMessage({
  message,
  streaming,
}: {
  message: ChatMessageView
  streaming: boolean
}) {
  const [openSources, setOpenSources] = useState(false)

  const unsupported = message.verdicts.filter((v) => v.verdict === 'unsupported').length

  return (
    <div>
      {message.refused ? (
        <p className="rounded-lg border border-border bg-surface-2 px-4 py-3 text-[15px] text-muted">
          {message.content}
        </p>
      ) : (
        <AnswerBody
          content={message.content}
          sources={message.sources}
          verdicts={message.verdicts}
          streaming={streaming}
          onCitationClick={() => setOpenSources(true)}
        />
      )}

      {!streaming && !message.refused && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <GroundingBadge score={message.groundingScore} unsupported={unsupported} />

          {message.sources.length > 0 && (
            <button
              type="button"
              onClick={() => setOpenSources((v) => !v)}
              className="rounded-md px-2 py-1 text-muted hover:bg-surface-2 hover:text-text"
            >
              {openSources ? 'Hide' : 'Show'} {message.sources.length} source
              {message.sources.length === 1 ? '' : 's'}
            </button>
          )}
        </div>
      )}

      {openSources && (
        <ol className="mt-3 space-y-2">
          {message.sources.map((source) => (
            <li key={source.n} className="card px-3 py-2 text-xs">
              <div className="flex items-baseline gap-2">
                <span className="rounded bg-accent-soft px-1 font-semibold text-accent">
                  {source.n}
                </span>
                <span className="font-medium">{source.title}</span>
                {source.location && <span className="text-muted">· {source.location}</span>}
              </div>
              <p className="mt-1 line-clamp-3 text-muted">{source.excerpt}</p>
              {source.sourceUrl && (
                <a
                  href={source.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="mt-1 block truncate text-accent hover:underline"
                >
                  {source.sourceUrl}
                </a>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function GroundingBadge({
  score,
  unsupported,
}: {
  score: number | null
  unsupported: number
}) {
  if (score === null) {
    return (
      <span
        className="rounded-md bg-surface-2 px-2 py-1 text-muted"
        title="Citations were not checked for this answer."
      >
        Not checked
      </span>
    )
  }

  const tone =
    score >= 90
      ? 'bg-success-soft text-success'
      : score >= 60
        ? 'bg-warning-soft text-warning'
        : 'bg-danger-soft text-danger'

  return (
    <span
      className={`rounded-md px-2 py-1 font-medium ${tone}`}
      title="Share of cited claims that the cited passage actually supports."
    >
      {score}% grounded
      {unsupported > 0 && ` · ${unsupported} unsupported`}
    </span>
  )
}

function ConversationList({
  conversations,
  activeId,
}: {
  conversations: ConversationSummary[]
  activeId?: string
}) {
  return (
    <aside className="shrink-0 border-b border-border md:h-dvh md:w-64 md:overflow-y-auto md:border-r md:border-b-0">
      <div className="p-3">
        <Link href="/chat" className="btn-ghost w-full">
          New conversation
        </Link>
      </div>

      <nav className="space-y-0.5 px-3 pb-3">
        {conversations.map((conversation) => (
          <Link
            key={conversation.id}
            href={`/chat/${conversation.id}`}
            aria-current={conversation.id === activeId ? 'page' : undefined}
            className={`block truncate rounded-lg px-3 py-2 text-sm transition-colors ${
              conversation.id === activeId
                ? 'bg-accent-soft font-medium text-accent'
                : 'text-muted hover:bg-surface-2 hover:text-text'
            }`}
          >
            {conversation.title}
          </Link>
        ))}
      </nav>
    </aside>
  )
}

function EmptyState({
  hasDocuments,
  onPick,
}: {
  hasDocuments: boolean
  onPick: (question: string) => void
}) {
  if (!hasDocuments) {
    return (
      <div className="py-16 text-center">
        <h1 className="text-lg font-semibold">Nothing to ask about yet</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
          Answers come only from documents you upload, so add one first.
        </p>
        <Link href="/documents" className="btn-primary mt-6">
          Add a document
        </Link>
      </div>
    )
  }

  const prompts = [
    'Summarise the key points',
    'What are the main obligations?',
    'What deadlines are mentioned?',
  ]

  return (
    <div className="py-16 text-center">
      <h1 className="text-lg font-semibold">Ask your documents</h1>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
        Every answer cites the passage it came from, and each citation is checked before you see it.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {prompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => onPick(prompt)}
            className="btn-ghost text-xs"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  )
}

function Composer({
  value,
  onChange,
  onSubmit,
  disabled,
  hasDocuments,
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: (question: string) => void
  disabled: boolean
  hasDocuments: boolean
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  // Grow with the content instead of scrolling a two-line box.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [value])

  function submit() {
    const question = value.trim()
    if (!question || disabled) return
    onSubmit(question)
  }

  return (
    <div className="border-t border-border bg-surface px-4 py-3">
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <textarea
          ref={ref}
          rows={1}
          value={value}
          disabled={!hasDocuments}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter breaks the line.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder={
            hasDocuments ? 'Ask a question about your documents…' : 'Add a document first'
          }
          className="input max-h-50 resize-none"
          aria-label="Your question"
        />
        <button
          type="button"
          onClick={submit}
          disabled={disabled || !value.trim()}
          className="btn-primary shrink-0"
        >
          Ask
        </button>
      </div>
    </div>
  )
}

/** Minimal SSE reader: the server only ever sends `data:` lines. */
async function readEventStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: StreamEvent) => void,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    // Events are separated by a blank line; a partial event stays buffered.
    let boundary = buffer.indexOf('\n\n')
    while (boundary !== -1) {
      const raw = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)

      const payload = raw.startsWith('data: ') ? raw.slice(6) : null
      if (payload) {
        try {
          onEvent(JSON.parse(payload) as StreamEvent)
        } catch {
          // A malformed frame is not worth tearing the stream down for.
        }
      }

      boundary = buffer.indexOf('\n\n')
    }
  }
}

type StreamEvent =
  | { type: 'status'; stage: Stage }
  | { type: 'meta'; conversationId: string; sources: SourceRef[] }
  | { type: 'delta'; text: string }
  | {
      type: 'done'
      messageId: string
      refused: boolean
      groundingScore: number | null
      uncitedCount: number
      checks: { sentenceIndex: number; verdict: SentenceVerdict['verdict']; reason: string | null }[]
    }
  | { type: 'error'; message: string }
