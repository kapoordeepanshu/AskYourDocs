import { NextResponse } from 'next/server'

import { route } from '@/lib/api'
import { corsHeaders, loadEnabledWidget, originAllowed } from '@/lib/widget'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ key: string }> }

/**
 * Public. Everything the widget needs to draw itself before the first
 * question, and nothing else: no owner, no document list.
 */
export const GET = route(async (request: Request, context: Context) => {
  const { key } = await context.params
  const origin = request.headers.get('origin')
  const widget = await loadEnabledWidget(key)

  if (!widget || !originAllowed(widget, origin)) {
    // Same answer for "no such widget" and "not allowed here", so the endpoint
    // cannot be used to probe which keys exist.
    return NextResponse.json(
      { error: { message: 'This chat is not available on this website.' } },
      { status: 404, headers: corsHeaders(origin) },
    )
  }

  return NextResponse.json(
    {
      widget: {
        title: widget.title,
        greeting: widget.greeting,
        accentColor: widget.accentColor,
      },
    },
    { headers: { ...corsHeaders(origin), 'cache-control': 'no-store' } },
  )
})

export function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) })
}
