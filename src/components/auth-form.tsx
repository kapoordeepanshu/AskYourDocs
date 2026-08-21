'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import type { ApiErrorBody } from '@/lib/api'

type Mode = 'login' | 'register'

interface Props {
  mode: Mode
  /** Where to go after success. Validated server-side before being passed in. */
  next: string
  /** Register is always allowed for the very first account, closed or not. */
  registrationOpen: boolean
}

const COPY = {
  login: {
    heading: 'Sign in',
    sub: 'Continue to your documents.',
    submit: 'Sign in',
    pending: 'Signing in',
    swapText: 'Need an account?',
    swapCta: 'Create one',
    swapHref: '/register',
  },
  register: {
    heading: 'Create your account',
    sub: 'The first account on a new instance becomes the administrator.',
    submit: 'Create account',
    pending: 'Creating account',
    swapText: 'Already have an account?',
    swapCta: 'Sign in',
    swapHref: '/login',
  },
} as const

export function AuthForm({ mode, next, registrationOpen }: Props) {
  const router = useRouter()
  const copy = COPY[mode]

  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setMessage(null)
    setFields({})

    const data = new FormData(event.currentTarget)
    const payload = {
      email: String(data.get('email') ?? ''),
      password: String(data.get('password') ?? ''),
      ...(mode === 'register' ? { name: String(data.get('name') ?? '') } : {}),
    }

    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ApiErrorBody | null
        setMessage(body?.error.message ?? 'Something went wrong. Please try again.')
        setFields(body?.error.fields ?? {})
        setPending(false)
        return
      }

      // Server components need to re-read the new session cookie.
      router.replace(next)
      router.refresh()
    } catch {
      setMessage('Could not reach the server. Check your connection and try again.')
      setPending(false)
    }
  }

  if (mode === 'register' && !registrationOpen) {
    return (
      <div className="text-center">
        <h1 className="text-xl font-semibold">Registration is closed</h1>
        <p className="mt-2 text-sm text-muted">
          This instance only accepts accounts created by an administrator.
        </p>
        <Link href="/login" className="btn-ghost mt-6 w-full">
          Back to sign in
        </Link>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-xl font-semibold">{copy.heading}</h1>
      <p className="mt-1.5 text-sm text-muted">{copy.sub}</p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        {mode === 'register' && (
          <div>
            <label className="label" htmlFor="name">
              Name <span className="font-normal text-muted">(optional)</span>
            </label>
            <input id="name" name="name" className="input" autoComplete="name" maxLength={120} />
          </div>
        )}

        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            autoFocus={mode === 'login'}
            className="input"
            aria-invalid={Boolean(fields.email)}
            aria-describedby={fields.email ? 'email-error' : undefined}
          />
          {fields.email && (
            <p id="email-error" className="field-error">
              {fields.email}
            </p>
          )}
        </div>

        <div>
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            className="input"
            aria-invalid={Boolean(fields.password)}
            aria-describedby={fields.password ? 'password-error' : undefined}
          />
          {fields.password ? (
            <p id="password-error" className="field-error">
              {fields.password}
            </p>
          ) : (
            mode === 'register' && (
              <p className="mt-1.5 text-xs text-muted">At least 10 characters.</p>
            )
          )}
        </div>

        {message && (
          <div
            role="alert"
            className="rounded-lg border border-border bg-danger-soft px-3 py-2 text-sm text-danger"
          >
            {message}
          </div>
        )}

        <button type="submit" className="btn-primary w-full" disabled={pending}>
          {pending ? (
            <>
              <Spinner />
              {copy.pending}
            </>
          ) : (
            copy.submit
          )}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        {copy.swapText}{' '}
        <Link href={copy.swapHref} className="font-medium text-accent hover:underline">
          {copy.swapCta}
        </Link>
      </p>
    </div>
  )
}

function Spinner() {
  return (
    <svg className="size-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}
