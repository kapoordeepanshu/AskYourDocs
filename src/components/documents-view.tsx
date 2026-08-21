'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import type { ApiErrorBody } from '@/lib/api'

export interface DocumentSummary {
  id: string
  title: string
  sourceType: 'pdf' | 'docx' | 'html' | 'markdown' | 'text' | 'url'
  sourceUrl: string | null
  filename: string | null
  byteSize: number | null
  status: 'pending' | 'parsing' | 'chunking' | 'embedding' | 'ready' | 'failed'
  error: string | null
  pageCount: number | null
  chunkCount: number
  createdAt: string
}

const IN_PROGRESS = ['pending', 'parsing', 'chunking', 'embedding'] as const

const STATUS_LABEL: Record<DocumentSummary['status'], string> = {
  pending: 'Queued',
  parsing: 'Reading',
  chunking: 'Splitting',
  embedding: 'Indexing',
  ready: 'Ready',
  failed: 'Failed',
}

const ACCEPT = '.pdf,.docx,.html,.htm,.md,.markdown,.txt'

export function DocumentsView({
  initialDocuments,
  maxUploadMb,
}: {
  initialDocuments: DocumentSummary[]
  maxUploadMb: number
}) {
  const [docs, setDocs] = useState(initialDocuments)
  const [banner, setBanner] = useState<{ tone: 'error' | 'info'; text: string } | null>(null)
  const [uploading, setUploading] = useState<string[]>([])
  const [dragging, setDragging] = useState(false)

  const busy = docs.some((d) => (IN_PROGRESS as readonly string[]).includes(d.status))

  const refresh = useCallback(async () => {
    const response = await fetch('/api/documents')
    if (!response.ok) return
    const body = (await response.json()) as { documents: DocumentSummary[] }
    setDocs(body.documents)
  }, [])

  // Poll only while something is actually being processed. A finished library
  // costs nothing, which matters on a tab someone leaves open all day.
  useEffect(() => {
    if (!busy) return
    const timer = setInterval(refresh, 2000)
    return () => clearInterval(timer)
  }, [busy, refresh])

  async function upload(files: FileList | File[]) {
    const list = Array.from(files)
    if (list.length === 0) return

    setBanner(null)
    setUploading((prev) => [...prev, ...list.map((f) => f.name)])

    for (const file of list) {
      const form = new FormData()
      form.append('file', file)

      try {
        const response = await fetch('/api/documents', { method: 'POST', body: form })
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as ApiErrorBody | null
          setBanner({
            tone: 'error',
            text: `${file.name}: ${body?.error.message ?? 'Upload failed.'}`,
          })
        }
      } catch {
        setBanner({ tone: 'error', text: `${file.name}: could not reach the server.` })
      } finally {
        setUploading((prev) => prev.filter((n) => n !== file.name))
      }
    }

    await refresh()
  }

  async function importUrl(url: string): Promise<boolean> {
    setBanner(null)
    try {
      const response = await fetch('/api/documents/url', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ApiErrorBody | null
        setBanner({ tone: 'error', text: body?.error.message ?? 'Could not import that URL.' })
        return false
      }
      await refresh()
      return true
    } catch {
      setBanner({ tone: 'error', text: 'Could not reach the server.' })
      return false
    }
  }

  async function remove(doc: DocumentSummary) {
    if (!confirm(`Delete "${doc.title}"? This also removes it from search and chat.`)) return
    setDocs((prev) => prev.filter((d) => d.id !== doc.id))
    const response = await fetch(`/api/documents/${doc.id}`, { method: 'DELETE' })
    if (!response.ok) {
      setBanner({ tone: 'error', text: 'Could not delete that document.' })
      await refresh()
    }
  }

  async function reindex(doc: DocumentSummary) {
    await fetch(`/api/documents/${doc.id}`, { method: 'POST' })
    await refresh()
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
        <p className="mt-1 text-sm text-muted">
          Upload files or import a page. Only you can see and search these.
        </p>
      </header>

      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          void upload(e.dataTransfer.files)
        }}
        className={`card border-dashed p-6 text-center transition-colors ${
          dragging ? 'border-accent bg-accent-soft' : ''
        }`}
      >
        <p className="text-sm font-medium">Drop files here</p>
        <p className="mt-1 text-xs text-muted">
          PDF, DOCX, HTML, Markdown, or text · up to {maxUploadMb} MB each
        </p>
        <label className="btn-ghost mt-4 cursor-pointer">
          Choose files
          <input
            type="file"
            multiple
            accept={ACCEPT}
            className="sr-only"
            onChange={(e) => {
              if (e.target.files) void upload(e.target.files)
              e.target.value = ''
            }}
          />
        </label>
      </div>

      <UrlImport onSubmit={importUrl} />

      {banner && (
        <div
          role="alert"
          className={`mt-4 rounded-lg border border-border px-3 py-2 text-sm ${
            banner.tone === 'error' ? 'bg-danger-soft text-danger' : 'bg-surface-2 text-muted'
          }`}
        >
          {banner.text}
        </div>
      )}

      <section className="mt-8">
        <h2 className="sr-only">Your documents</h2>

        {uploading.map((name) => (
          <div key={name} className="card mb-2 flex items-center gap-3 px-4 py-3">
            <Spinner />
            <span className="truncate text-sm text-muted">Uploading {name}…</span>
          </div>
        ))}

        {docs.length === 0 && uploading.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted">
            Nothing here yet. Add a document to start asking questions.
          </p>
        ) : (
          <ul className="space-y-2">
            {docs.map((doc) => (
              <DocumentRow key={doc.id} doc={doc} onDelete={remove} onReindex={reindex} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function UrlImport({ onSubmit }: { onSubmit: (url: string) => Promise<boolean> }) {
  const [value, setValue] = useState('')
  const [pending, setPending] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <form
      className="mt-4 flex gap-2"
      onSubmit={async (event) => {
        event.preventDefault()
        if (!value.trim()) return
        setPending(true)
        const ok = await onSubmit(value.trim())
        setPending(false)
        if (ok) {
          setValue('')
          inputRef.current?.focus()
        }
      }}
    >
      <input
        ref={inputRef}
        type="url"
        inputMode="url"
        placeholder="https://example.com/handbook"
        className="input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label="Import a page by URL"
      />
      <button type="submit" className="btn-ghost shrink-0" disabled={pending || !value.trim()}>
        {pending ? <Spinner /> : null}
        {pending ? 'Fetching' : 'Import URL'}
      </button>
    </form>
  )
}

function DocumentRow({
  doc,
  onDelete,
  onReindex,
}: {
  doc: DocumentSummary
  onDelete: (doc: DocumentSummary) => void
  onReindex: (doc: DocumentSummary) => void
}) {
  const inProgress = (IN_PROGRESS as readonly string[]).includes(doc.status)

  return (
    <li className="card flex items-start gap-3 px-4 py-3">
      <span className="mt-0.5 shrink-0 rounded-md bg-surface-2 px-1.5 py-1 text-[10px] font-semibold tracking-wide text-muted uppercase">
        {doc.sourceType}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{doc.title}</p>

        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
          <StatusBadge doc={doc} />
          {doc.status === 'ready' && (
            <>
              <span aria-hidden="true">·</span>
              <span>
                {doc.chunkCount} passage{doc.chunkCount === 1 ? '' : 's'}
              </span>
              {doc.pageCount ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{doc.pageCount} pages</span>
                </>
              ) : null}
            </>
          )}
          {doc.byteSize ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{formatBytes(doc.byteSize)}</span>
            </>
          ) : null}
        </p>

        {doc.sourceUrl && (
          <a
            href={doc.sourceUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="mt-1 block truncate text-xs text-accent hover:underline"
          >
            {doc.sourceUrl}
          </a>
        )}

        {doc.status === 'failed' && doc.error && (
          <p className="mt-1.5 rounded-md bg-danger-soft px-2 py-1 text-xs text-danger">
            {doc.error}
          </p>
        )}
      </div>

      <div className="flex shrink-0 gap-1">
        {!inProgress && (
          <button
            type="button"
            onClick={() => onReindex(doc)}
            className="rounded-md px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-text"
            title="Parse and index this document again"
          >
            Re-index
          </button>
        )}
        <button
          type="button"
          onClick={() => onDelete(doc)}
          className="rounded-md px-2 py-1 text-xs text-muted hover:bg-danger-soft hover:text-danger"
        >
          Delete
        </button>
      </div>
    </li>
  )
}

function StatusBadge({ doc }: { doc: DocumentSummary }) {
  const inProgress = (IN_PROGRESS as readonly string[]).includes(doc.status)

  if (doc.status === 'ready') return <span className="text-success">Ready</span>
  if (doc.status === 'failed') return <span className="text-danger">Failed</span>

  return (
    <span className="flex items-center gap-1.5 text-warning">
      {inProgress && <Spinner className="size-3" />}
      {STATUS_LABEL[doc.status]}
      {doc.status === 'embedding' && doc.chunkCount > 0 ? ` ${doc.chunkCount} passages` : ''}
    </span>
  )
}

function Spinner({ className = 'size-4' }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
