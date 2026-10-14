'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import type { ApiErrorBody } from '@/lib/api'

export interface WidgetSummary {
  id: string
  publicKey: string
  name: string
  title: string
  greeting: string
  fallbackMessage: string
  accentColor: string
  allowedOrigins: string[]
  documentIds: string[] | null
  enabled: boolean
  questions30d: number
  unanswered30d: number
  recentUnanswered: { question: string; askedAt: string }[]
}

interface DocumentOption {
  id: string
  title: string
}

interface Draft {
  name: string
  title: string
  greeting: string
  fallbackMessage: string
  accentColor: string
  origins: string
  scope: 'all' | 'selected'
  documentIds: string[]
  enabled: boolean
}

const NEW_DRAFT: Draft = {
  name: 'Website',
  title: 'Ask us anything',
  greeting: 'Hi! Ask me anything about our services, policies, or opening hours.',
  fallbackMessage:
    "I'm sorry, I don't have that information. Please contact us directly and we'll be happy to help.",
  accentColor: '#2563eb',
  origins: '',
  scope: 'all',
  documentIds: [],
  enabled: true,
}

function toDraft(widget: WidgetSummary): Draft {
  return {
    name: widget.name,
    title: widget.title,
    greeting: widget.greeting,
    fallbackMessage: widget.fallbackMessage,
    accentColor: widget.accentColor,
    origins: widget.allowedOrigins.join('\n'),
    scope: widget.documentIds === null ? 'all' : 'selected',
    documentIds: widget.documentIds ?? [],
    enabled: widget.enabled,
  }
}

function snippet(appUrl: string, publicKey: string): string {
  return `<script src="${appUrl}/widget.js" data-key="${publicKey}" async></script>`
}

export function WidgetsView({
  widgets,
  documents,
  appUrl,
}: {
  widgets: WidgetSummary[]
  documents: DocumentOption[]
  appUrl: string
}) {
  const [editing, setEditing] = useState<string | 'new' | null>(widgets.length === 0 ? 'new' : null)

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Website widget</h1>
          <p className="mt-1 text-sm text-muted">
            A chat box for your own website that answers visitors from your documents, with
            sources. Paste one line of HTML to install it.
          </p>
        </div>
        {editing !== 'new' && (
          <button type="button" className="btn-primary" onClick={() => setEditing('new')}>
            New widget
          </button>
        )}
      </header>

      {documents.length === 0 && (
        <p className="mb-4 rounded-lg border border-border bg-warning-soft px-3 py-2 text-sm">
          You have no ready documents yet. A widget can only answer from documents you have
          uploaded, so add some on the Documents page first.
        </p>
      )}

      {editing === 'new' && (
        <WidgetForm
          initial={NEW_DRAFT}
          documents={documents}
          onDone={() => setEditing(null)}
          onCancel={widgets.length > 0 ? () => setEditing(null) : undefined}
        />
      )}

      <ul className="space-y-4">
        {widgets.map((widget) => (
          <li key={widget.id}>
            {editing === widget.id ? (
              <WidgetForm
                widgetId={widget.id}
                initial={toDraft(widget)}
                documents={documents}
                onDone={() => setEditing(null)}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <WidgetCard
                widget={widget}
                appUrl={appUrl}
                documentCount={documents.length}
                onEdit={() => setEditing(widget.id)}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function WidgetCard({
  widget,
  appUrl,
  documentCount,
  onEdit,
}: {
  widget: WidgetSummary
  appUrl: string
  documentCount: number
  onEdit: () => void
}) {
  const router = useRouter()
  const [copied, setCopied] = useState(false)
  const code = snippet(appUrl, widget.publicKey)

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* the snippet is selectable as a fallback */
    }
  }

  async function remove() {
    if (
      !confirm(
        `Delete "${widget.name}"? It stops working on every website it is installed on, and its visitor conversations are deleted.`,
      )
    ) {
      return
    }
    await fetch(`/api/widgets/${widget.id}`, { method: 'DELETE' })
    router.refresh()
  }

  const scope =
    widget.documentIds === null
      ? `All documents (${documentCount})`
      : `${widget.documentIds.length} selected document${widget.documentIds.length === 1 ? '' : 's'}`

  return (
    <article className="card p-5">
      <div className="flex flex-wrap items-start gap-3">
        <span
          className="mt-1 size-4 shrink-0 rounded-full border border-border"
          style={{ background: widget.accentColor }}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">
            {widget.name}
            {!widget.enabled && (
              <span className="ml-2 rounded-md bg-surface-2 px-1.5 py-0.5 text-xs font-medium text-muted">
                Paused
              </span>
            )}
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            {scope} ·{' '}
            {widget.allowedOrigins.length === 0
              ? 'Any website can embed it'
              : widget.allowedOrigins.join(', ')}
          </p>
        </div>
        <div className="flex gap-2">
          <a className="btn-ghost" href={`/preview/${widget.publicKey}`} target="_blank" rel="noreferrer">
            Preview
          </a>
          <button type="button" className="btn-ghost" onClick={onEdit}>
            Edit
          </button>
          <button type="button" className="btn-danger" onClick={remove}>
            Delete
          </button>
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-sm font-medium">Install</span>
          <button type="button" className="text-sm text-accent hover:underline" onClick={copy}>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <pre className="overflow-x-auto rounded-lg bg-surface-2 px-3 py-2.5 font-mono text-xs select-all">
          {code}
        </pre>
        <p className="mt-1.5 text-xs text-muted">
          Paste this just before <code className="font-mono">&lt;/body&gt;</code> on every page
          that should show the chat.
        </p>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-[auto_1fr]">
        <dl className="flex gap-6 sm:flex-col sm:gap-2">
          <div>
            <dt className="text-xs text-muted">Questions, 30 days</dt>
            <dd className="text-lg font-semibold">{widget.questions30d}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Not answered</dt>
            <dd className="text-lg font-semibold">{widget.unanswered30d}</dd>
          </div>
        </dl>

        <div className="min-w-0">
          <h3 className="text-sm font-medium">Recent questions it could not answer</h3>
          {widget.recentUnanswered.length === 0 ? (
            <p className="mt-1 text-sm text-muted">None yet.</p>
          ) : (
            <>
              <p className="mt-0.5 text-xs text-muted">
                Each of these is a gap in your documents. Adding a page that covers it fixes the
                answer for every visitor after.
              </p>
              <ul className="mt-2 space-y-1">
                {widget.recentUnanswered.map((item) => (
                  <li
                    key={`${item.askedAt}-${item.question}`}
                    className="flex gap-3 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate" title={item.question}>
                      {item.question}
                    </span>
                    <time className="shrink-0 text-xs text-muted" dateTime={item.askedAt}>
                      {new Date(item.askedAt).toLocaleDateString()}
                    </time>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </article>
  )
}

function WidgetForm({
  widgetId,
  initial,
  documents,
  onDone,
  onCancel,
}: {
  widgetId?: string
  initial: Draft
  documents: DocumentOption[]
  onDone: () => void
  onCancel?: () => void
}) {
  const router = useRouter()
  const [draft, setDraft] = useState(initial)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }))

  function toggleDocument(id: string) {
    set(
      'documentIds',
      draft.documentIds.includes(id)
        ? draft.documentIds.filter((d) => d !== id)
        : [...draft.documentIds, id],
    )
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)
    setFields({})

    try {
      const response = await fetch(widgetId ? `/api/widgets/${widgetId}` : '/api/widgets', {
        method: widgetId ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: draft.name,
          title: draft.title,
          greeting: draft.greeting,
          fallbackMessage: draft.fallbackMessage,
          accentColor: draft.accentColor,
          allowedOrigins: draft.origins.split(/[\s,]+/).filter(Boolean),
          documentIds: draft.scope === 'all' ? null : draft.documentIds,
          enabled: draft.enabled,
        }),
      })

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ApiErrorBody | null
        setError(body?.error.message ?? 'The widget could not be saved.')
        setFields(body?.error.fields ?? {})
        return
      }

      router.refresh()
      onDone()
    } finally {
      setPending(false)
    }
  }

  const fieldError = (key: string) =>
    fields[key] ? <p className="field-error">{fields[key]}</p> : null

  return (
    <form onSubmit={submit} className="card mb-4 space-y-5 p-5">
      <h2 className="font-semibold">{widgetId ? 'Edit widget' : 'New widget'}</h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="w-name">
            Name
          </label>
          <input
            id="w-name"
            className="input"
            value={draft.name}
            onChange={(e) => set('name', e.target.value)}
            maxLength={80}
            required
          />
          <p className="mt-1 text-xs text-muted">Only you see this.</p>
          {fieldError('name')}
        </div>
        <div>
          <label className="label" htmlFor="w-title">
            Chat title
          </label>
          <input
            id="w-title"
            className="input"
            value={draft.title}
            onChange={(e) => set('title', e.target.value)}
            maxLength={80}
            required
          />
          {fieldError('title')}
        </div>
      </div>

      <div>
        <label className="label" htmlFor="w-greeting">
          Greeting
        </label>
        <textarea
          id="w-greeting"
          className="input"
          rows={2}
          value={draft.greeting}
          onChange={(e) => set('greeting', e.target.value)}
          maxLength={500}
          required
        />
        {fieldError('greeting')}
      </div>

      <div>
        <label className="label" htmlFor="w-fallback">
          When the answer is not in your documents
        </label>
        <textarea
          id="w-fallback"
          className="input"
          rows={2}
          value={draft.fallbackMessage}
          onChange={(e) => set('fallbackMessage', e.target.value)}
          maxLength={500}
          required
        />
        <p className="mt-1 text-xs text-muted">
          Shown instead of a guess. A phone number or email address here turns a dead end into a
          lead.
        </p>
        {fieldError('fallbackMessage')}
      </div>

      <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
        <div>
          <label className="label" htmlFor="w-color">
            Colour
          </label>
          <div className="flex items-center gap-2">
            <input
              id="w-color"
              type="color"
              className="h-9 w-12 cursor-pointer rounded-lg border border-border bg-surface"
              value={draft.accentColor}
              onChange={(e) => set('accentColor', e.target.value)}
            />
            <input
              aria-label="Colour as hex"
              className="input w-28 font-mono"
              value={draft.accentColor}
              onChange={(e) => set('accentColor', e.target.value)}
              maxLength={7}
            />
          </div>
          {fieldError('accentColor')}
        </div>
        <div>
          <label className="label" htmlFor="w-origins">
            Allowed websites
          </label>
          <textarea
            id="w-origins"
            className="input font-mono"
            rows={2}
            placeholder={'https://www.example.com\nhttps://*.example.com'}
            value={draft.origins}
            onChange={(e) => set('origins', e.target.value)}
          />
          <p className="mt-1 text-xs text-muted">
            One per line. Leave empty to allow any website, which also lets anyone who copies
            your snippet use your model quota.
          </p>
          {fieldError('allowedOrigins')}
        </div>
      </div>

      <fieldset>
        <legend className="label">Answers come from</legend>
        <div className="space-y-1.5 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="scope"
              checked={draft.scope === 'all'}
              onChange={() => set('scope', 'all')}
            />
            All my documents, including ones I add later
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="scope"
              checked={draft.scope === 'selected'}
              onChange={() => set('scope', 'selected')}
            />
            Only the documents I choose
          </label>
        </div>

        {draft.scope === 'selected' && (
          <div className="mt-3 max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border p-3">
            {documents.length === 0 ? (
              <p className="text-sm text-muted">No ready documents yet.</p>
            ) : (
              documents.map((doc) => (
                <label key={doc.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={draft.documentIds.includes(doc.id)}
                    onChange={() => toggleDocument(doc.id)}
                  />
                  <span className="truncate">{doc.title}</span>
                </label>
              ))
            )}
          </div>
        )}
        <p className="mt-1.5 text-xs text-muted">
          Keep internal documents out of a public widget: visitors can ask about anything in
          scope.
        </p>
        {fieldError('documentIds')}
      </fieldset>

      {widgetId && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => set('enabled', e.target.checked)}
          />
          Enabled. Untick to pause the widget everywhere it is installed.
        </label>
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? 'Saving…' : widgetId ? 'Save changes' : 'Create widget'}
        </button>
        {onCancel && (
          <button type="button" className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}
