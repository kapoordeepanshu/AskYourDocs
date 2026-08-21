'use client'

import { useEffect } from 'react'

/**
 * Last-resort boundary. The message from a server exception is deliberately
 * not rendered: it can carry connection strings and provider detail that
 * belong in the server log, not in the browser.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="mt-2 max-w-sm text-sm text-muted">
        The page could not be loaded. If this keeps happening, check the server logs.
      </p>
      {error.digest && (
        <p className="mt-2 font-mono text-xs text-muted">Reference: {error.digest}</p>
      )}
      <button type="button" onClick={reset} className="btn-primary mt-6">
        Try again
      </button>
    </main>
  )
}
