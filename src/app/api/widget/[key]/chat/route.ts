import { NextResponse } from 'next/server'
import { z } from 'zod'

import { clientIp, parseJson, route } from '@/lib/api'
import { env } from '@/lib/env'
import { hit } from '@/lib/rate-limit'
import { answerQuestion, type AnswerEvent } from '@/lib/rag/answer'
import { corsHeaders, loadEnabledWidget, originAllowed } from '@/lib/widget'
import { buildSegments, type AnswerSegment } from '@/lib/widget/segments'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
/** Verification adds a second model round trip after generation. */
export const maxDuration = 300

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/** Matches no document, for a widget whose selected documents are all gone. */
const NO_DOCUMENT = '00000000-0000-0000-0000-000000000000'

const bodySchema = z.object({
  question: z.string().trim().min(1, 'Ask a question.').max(1000),
  conversationId: z.string().uuid().optional(),
})

/** What the widget receives: the owner chat's events, plus the verified final render. */
type WidgetEvent =
  | Exclude<AnswerEvent, { type: 'done' }>
  | { type: 'done'; refused: boolean }
  | { type: 'final'; segments: AnswerSegment[]; removed: number }

type Context = { params: Promise<{ key: string }> }

function deny(status: number, message: string, headers: Record<string, string>) {
  return NextResponse.json({ error: { message } }, { status, headers })
}

export const POST = route(async (request: Request, context: Context) => {
  const { key } = await context.params
  const origin = request.headers.get('origin')
  const cors = corsHeaders(origin)

  const widget = await loadEnabledWidget(key)
  if (!widget || !originAllowed(widget, origin)) {
    return deny(404, 'This chat is not available on this website.', cors)
  }

  const { question, conversationId } = await parseJson(request, bodySchema)

  // Per visitor first, so one noisy visitor runs into their own limit before
  // they can use up the widget's daily allowance for everyone else.
  const visitor = await hit(
    `widget:${widget.id}:ip:${clientIp(request) ?? 'unknown'}`,
    env().WIDGET_VISITOR_HOURLY_LIMIT,
    HOUR_MS,
  )
  if (!visitor.ok) {
    return deny(429, 'You have asked a lot of questions. Please try again a little later.', {
      ...cors,
      'retry-after': String(visitor.retryAfterSeconds),
    })
  }

  const daily = await hit(`widget:${widget.id}:day`, env().WIDGET_DAILY_LIMIT, DAY_MS)
  if (!daily.ok) {
    return deny(429, 'This chat is busy right now. Please try again later.', {
      ...cors,
      'retry-after': String(daily.retryAfterSeconds),
    })
  }

  // Null scope means every document the owner has. An explicit selection whose
  // documents have all since been deleted must answer from nothing, not from
  // everything, which is what an empty filter would do.
  const documentIds =
    widget.documentIds === null
      ? undefined
      : widget.documentIds.length > 0
        ? widget.documentIds
        : [NO_DOCUMENT]

  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: WidgetEvent) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))

      let answer = ''
      try {
        for await (const event of answerQuestion({
          ownerId: widget.ownerId,
          question,
          conversationId,
          documentIds,
          signal: request.signal,
          widget: { id: widget.id, fallbackMessage: widget.fallbackMessage },
        })) {
          if (event.type === 'delta') answer += event.text

          if (event.type === 'done') {
            if (!event.refused) send({ type: 'final', ...buildSegments(answer, event.checks) })
            // Verifier reasoning is for the owner's review, not the visitor.
            send({ type: 'done', refused: event.refused })
            continue
          }

          if (event.type === 'error') {
            // Provider errors name configuration ("check GROQ_API_KEY") that is
            // for the operator, not for a stranger on someone's website.
            console.error('[widget chat]', event.message)
            send({ type: 'error', message: 'Something went wrong. Please try again.' })
            continue
          }

          send(event)
        }
      } catch (error) {
        console.error('[widget chat]', error)
        send({ type: 'error', message: 'Something went wrong. Please try again.' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      ...cors,
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  })
})

export function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) })
}
