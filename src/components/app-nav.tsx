'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'

import type { SessionUser } from '@/lib/auth/session'

const LINKS = [
  { href: '/documents', label: 'Documents', icon: DocIcon },
  { href: '/chat', label: 'Chat', icon: ChatIcon },
  { href: '/search', label: 'Search', icon: SearchIcon },
] as const

export function AppNav({ user }: { user: SessionUser }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  const links = [...LINKS, ...(user.role === 'admin' ? [ADMIN_LINK] : [])]

  return (
    <>
      {/* Mobile bar */}
      <div className="flex items-center gap-2 border-b border-border bg-surface px-4 py-3 md:hidden">
        <button
          type="button"
          className="btn-ghost px-2 py-1.5"
          aria-expanded={open}
          aria-controls="app-sidebar"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="sr-only">{open ? 'Close navigation' : 'Open navigation'}</span>
          <MenuIcon />
        </button>
        <span className="font-semibold tracking-tight">AskYourDocs</span>
      </div>

      <aside
        id="app-sidebar"
        className={`${open ? 'flex' : 'hidden'} w-full shrink-0 flex-col border-b border-border bg-surface md:flex md:h-dvh md:w-60 md:border-r md:border-b-0`}
      >
        <div className="hidden items-center gap-2 px-5 py-5 md:flex">
          <span className="font-semibold tracking-tight">AskYourDocs</span>
        </div>

        <nav className="flex-1 space-y-0.5 px-3 py-3 md:py-0">
          {links.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`)
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                  active
                    ? 'bg-accent-soft font-medium text-accent'
                    : 'text-muted hover:bg-surface-2 hover:text-text'
                }`}
              >
                <Icon />
                {label}
              </Link>
            )
          })}
        </nav>

        <UserMenu user={user} />
      </aside>
    </>
  )
}

const ADMIN_LINK = { href: '/admin', label: 'Admin', icon: ShieldIcon } as const

function UserMenu({ user }: { user: SessionUser }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function signOut() {
    setPending(true)
    await fetch('/api/auth/logout', { method: 'POST' })
    router.replace('/login')
    router.refresh()
  }

  return (
    <div className="border-t border-border p-3">
      <div className="px-2 pb-2">
        <p className="truncate text-sm font-medium">{user.name || user.email}</p>
        <p className="truncate text-xs text-muted">
          {user.name ? user.email : user.role === 'admin' ? 'Administrator' : 'Member'}
        </p>
      </div>
      <button
        type="button"
        onClick={signOut}
        disabled={pending}
        className="w-full rounded-lg px-2 py-1.5 text-left text-sm text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-50"
      >
        {pending ? 'Signing out…' : 'Sign out'}
      </button>
    </div>
  )
}

/* Icons kept inline: a handful of 20px glyphs is not worth a dependency. */

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

function DocIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4.5" aria-hidden="true">
      <path d="M6 3h7l5 5v13H6z" {...stroke} />
      <path d="M13 3v5h5M9 13h6M9 17h4" {...stroke} />
    </svg>
  )
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4.5" aria-hidden="true">
      <path d="M20 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z" {...stroke} />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4.5" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" {...stroke} />
      <path d="m16 16 4 4" {...stroke} />
    </svg>
  )
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4.5" aria-hidden="true">
      <path d="M12 3l7 3v6c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V6z" {...stroke} />
    </svg>
  )
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" {...stroke} />
    </svg>
  )
}
