import { randomBytes } from 'node:crypto'

import { and, eq } from 'drizzle-orm'

import { db } from '@/lib/db'
import { widgets, type Widget } from '@/lib/db/schema'
import { env } from '@/lib/env'
import { isOriginAllowed } from './origins'

export * from './origins'

/**
 * Public, not secret: see the note on the widgets table. Prefixed so it is
 * recognisable when someone finds it in a page's source.
 */
export function generatePublicKey(): string {
  return `wk_${randomBytes(18).toString('base64url')}`
}

export const PUBLIC_KEY_PATTERN = /^wk_[A-Za-z0-9_-]{16,64}$/

export async function loadEnabledWidget(publicKey: string): Promise<Widget | null> {
  if (!PUBLIC_KEY_PATTERN.test(publicKey)) return null
  const [widget] = await db
    .select()
    .from(widgets)
    .where(and(eq(widgets.publicKey, publicKey), eq(widgets.enabled, true)))
    .limit(1)
  return widget ?? null
}

export function appOrigin(): string {
  return new URL(env().APP_URL).origin
}

export function originAllowed(widget: Widget, origin: string | null): boolean {
  return isOriginAllowed(widget.allowedOrigins, origin, appOrigin())
}

/**
 * CORS headers for a widget response. The origin is echoed back only after it
 * has passed the allowlist, never as a blanket `*`. No credentials: the widget
 * sends no cookies, so a visitor who happens to be signed in to this app never
 * carries that session into a request.
 */
export function corsHeaders(origin: string | null): Record<string, string> {
  return {
    ...(origin ? { 'access-control-allow-origin': origin } : {}),
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '600',
    vary: 'Origin',
  }
}
