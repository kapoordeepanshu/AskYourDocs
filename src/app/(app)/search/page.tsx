import type { Metadata } from 'next'
import Link from 'next/link'

import { requirePageUser } from '@/lib/auth'
import { describeLocation } from '@/lib/rag/prompt'
import { retrieve } from '@/lib/rag/retrieve'

export const metadata: Metadata = { title: 'Search' }
export const dynamic = 'force-dynamic'

/**
 * A plain GET form rather than a debounced client search. Each keystroke here
 * would cost an embedding call, and the result is a shareable, reloadable URL
 * that works without JavaScript.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const user = await requirePageUser('/search')
  const query = (await searchParams).q?.trim() ?? ''

  const results = query ? await retrieve(user.id, query, { candidates: 25 }) : []

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
        <p className="mt-1 text-sm text-muted">
          The same retrieval the chat uses, without the answer. Useful for checking what a question
          would actually find.
        </p>
      </header>

      <form method="get" className="flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={query}
          autoFocus
          placeholder="Search across your documents…"
          className="input"
          aria-label="Search your documents"
        />
        <button type="submit" className="btn-primary shrink-0">
          Search
        </button>
      </form>

      {query && (
        <p className="mt-6 text-sm text-muted">
          {results.length === 0
            ? 'No passages matched.'
            : `${results.length} passage${results.length === 1 ? '' : 's'}`}
        </p>
      )}

      <ul className="mt-4 space-y-3">
        {results.map((result) => {
          const location = describeLocation(result)
          return (
            <li key={result.chunkId} className="card px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
                <span className="font-medium">{result.documentTitle}</span>
                {location && <span className="text-xs text-muted">{location}</span>}
                <span className="ml-auto text-xs text-muted">
                  {result.similarity !== null
                    ? `${Math.round(result.similarity * 100)}% match`
                    : 'keyword match'}
                </span>
              </div>

              <p className="mt-2 text-sm text-muted">{result.content.slice(0, 400)}…</p>

              {result.sourceUrl && (
                <a
                  href={result.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="mt-2 block truncate text-xs text-accent hover:underline"
                >
                  {result.sourceUrl}
                </a>
              )}
            </li>
          )
        })}
      </ul>

      {query && results.length === 0 && (
        <p className="mt-6 text-sm text-muted">
          Nothing matched. Check that the document finished indexing on the{' '}
          <Link href="/documents" className="text-accent hover:underline">
            documents page
          </Link>
          .
        </p>
      )}
    </div>
  )
}
