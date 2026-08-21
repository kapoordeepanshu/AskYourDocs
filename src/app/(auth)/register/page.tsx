import { sql } from 'drizzle-orm'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { AuthForm } from '@/components/auth-form'
import { getCurrentUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { env } from '@/lib/env'
import { safeNext } from '@/lib/paths'

export const metadata: Metadata = { title: 'Create account' }

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const params = await searchParams
  const next = safeNext(params.next)

  if (await getCurrentUser()) redirect(next)

  // A brand-new instance must always allow the first account through, even when
  // public registration is off, or there would be nobody to open it.
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(users)
  const registrationOpen = count === 0 || env().ALLOW_PUBLIC_REGISTRATION

  return <AuthForm mode="register" next={next} registrationOpen={registrationOpen} />
}
