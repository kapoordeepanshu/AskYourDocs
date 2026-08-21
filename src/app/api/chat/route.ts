import { z } from 'zod'

import { parseJson, route } from '@/lib/api'
import { requireUser } from '@/lib/auth'
import { answerQuestion, type AnswerEvent } from '@/lib/rag/answer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
/** Verification adds a second model round trip after generation. */
export const maxDuration = 300

const bodySchema = z.object({
  question: z.string().trim().min(1, 'Ask a question.').max(2000),
  conversationId: z.string().uuid().optional(),
  documentIds: z.array(z.string().uuid()).max(50).optional(),
})

function encodeEvent(event: AnswerEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

export const POST = route(async (request: Request) => {
  const user = await requireUser()
  const { question, conversationId, documentIds } = await parseJson(request, bodySchema)

  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AnswerEvent) => controller.enqueue(encoder.encode(encodeEvent(event)))

      try {
        for await (const event of answerQuestion({
          ownerId: user.id,
          question,
          conversationId,
          documentIds,
          signal: request.signal,
        })) {
          send(event)
        }
      } catch (error) {
        // The response has already begun, so an HTTP status is no longer
        // available: the failure has to travel as an event.
        console.error('[chat]', error)
        send({
          type: 'error',
          message: error instanceof Error ? error.message : 'Something went wrong.',
        })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Without this, nginx buffers the whole response and the answer arrives
      // in one lump instead of streaming.
      'x-accel-buffering': 'no',
    },
  })
})
