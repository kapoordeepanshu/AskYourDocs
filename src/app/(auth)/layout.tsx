import Link from 'next/link'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <Link href="/" className="mb-8 flex items-center gap-2">
        <Logo />
        <span className="text-lg font-semibold tracking-tight">AskYourDocs</span>
      </Link>

      <div className="card w-full max-w-sm p-6 sm:p-8">{children}</div>

      <p className="mt-8 max-w-sm text-center text-xs text-muted">
        Your documents stay on this server. Answers are generated only from what you upload.
      </p>
    </main>
  )
}

function Logo() {
  return (
    <svg viewBox="0 0 24 24" className="size-7 text-accent" aria-hidden="true">
      <path
        d="M6 3h7l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M13 3v5h5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <circle cx="11.5" cy="14" r="3" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="m14 16.5 2.5 2.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}
