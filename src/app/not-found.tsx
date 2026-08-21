import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <p className="text-sm font-medium text-accent">404</p>
      <h1 className="mt-2 text-xl font-semibold">Not found</h1>
      <p className="mt-2 max-w-sm text-sm text-muted">
        This page does not exist, or it belongs to another account.
      </p>
      <Link href="/documents" className="btn-ghost mt-6">
        Back to your documents
      </Link>
    </main>
  )
}
