import { and, eq } from 'drizzle-orm'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { requirePageUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { widgets } from '@/lib/db/schema'

export const metadata: Metadata = { title: 'Widget preview' }
export const dynamic = 'force-dynamic'

/**
 * A blank stand-in for the owner's website, outside the app layout so the
 * widget is seen the way a visitor would see it. The app's own origin is
 * always allowed, so this works before any website is on the allowlist.
 */
export default async function WidgetPreviewPage({
  params,
}: {
  params: Promise<{ key: string }>
}) {
  const { key } = await params
  const user = await requirePageUser(`/preview/${key}`)

  const [widget] = await db
    .select({ name: widgets.name, enabled: widgets.enabled, publicKey: widgets.publicKey })
    .from(widgets)
    .where(and(eq(widgets.publicKey, key), eq(widgets.ownerId, user.id)))
    .limit(1)

  if (!widget) notFound()

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <p className="text-sm font-medium text-accent">Preview</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight">{widget.name}</h1>
      <p className="mt-4 text-muted">
        This page stands in for your website. The chat button in the corner is exactly what your
        visitors get, answering from the documents this widget is scoped to.
      </p>
      {widget.enabled ? (
        <p className="mt-4 text-muted">Questions asked here count towards its statistics.</p>
      ) : (
        <p className="mt-6 rounded-lg bg-warning-soft px-3 py-2 text-sm">
          This widget is paused, so it does not load. Enable it from the Website widget page.
        </p>
      )}
      {widget.enabled && <script src="/widget.js" data-key={widget.publicKey} async />}
    </div>
  )
}
