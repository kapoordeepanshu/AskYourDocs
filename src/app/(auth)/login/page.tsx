import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { AuthForm } from '@/components/auth-form'
import { getCurrentUser } from '@/lib/auth'
import { safeNext } from '@/lib/paths'

export const metadata: Metadata = { title: 'Sign in' }

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const params = await searchParams
  const next = safeNext(params.next)

  if (await getCurrentUser()) redirect(next)

  return <AuthForm mode="login" next={next} registrationOpen />
}
