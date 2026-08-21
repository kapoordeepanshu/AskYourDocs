import { NextResponse } from 'next/server'
import { ZodError, type ZodSchema } from 'zod'

import { AuthError } from '@/lib/auth'
import { ProviderError } from '@/lib/llm/types'

/**
 * One shape for every error the API returns, so the client never has to guess:
 *   { error: { message, code?, fields? } }
 *
 * `message` is always safe to show a user directly. Anything an operator needs
 * but a user should not see goes to the server log instead.
 */
export interface ApiErrorBody {
  error: {
    message: string
    code?: string
    fields?: Record<string, string>
  }
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export const badRequest = (message: string, fields?: Record<string, string>) =>
  new HttpError(400, message, 'bad_request', fields)

export const notFound = (what = 'Not found.') => new HttpError(404, what, 'not_found')

export const tooLarge = (message: string) => new HttpError(413, message, 'too_large')

export function json<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init)
}

/**
 * Converts anything thrown inside a route handler into a response. Keeps
 * handlers linear: throw where the problem is, let this decide the status.
 */
export function apiError(error: unknown): NextResponse<ApiErrorBody> {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: { message: error.message } }, { status: error.status })
  }

  if (error instanceof HttpError) {
    return NextResponse.json(
      { error: { message: error.message, code: error.code, fields: error.fields } },
      { status: error.status },
    )
  }

  if (error instanceof ZodError) {
    const fields: Record<string, string> = {}
    for (const issue of error.issues) {
      const key = issue.path.join('.') || '_'
      fields[key] ??= issue.message
    }
    return NextResponse.json(
      { error: { message: 'Please check the highlighted fields.', code: 'invalid', fields } },
      { status: 400 },
    )
  }

  if (error instanceof ProviderError) {
    // The provider message names the misconfiguration (missing key, model not
    // pulled, Ollama not running), which is exactly what a self-hoster needs.
    console.error('[provider]', error)
    return NextResponse.json(
      { error: { message: error.message, code: 'provider_error' } },
      { status: 502 },
    )
  }

  console.error('[unhandled]', error)
  return NextResponse.json(
    { error: { message: 'Something went wrong. Please try again.', code: 'internal' } },
    { status: 500 },
  )
}

/** Wraps a handler so every throw becomes a well-formed error response. */
export function route<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    try {
      return await handler(...args)
    } catch (error) {
      return apiError(error)
    }
  }
}

export async function parseJson<T>(request: Request, schema: ZodSchema<T>): Promise<T> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw badRequest('Expected a JSON body.')
  }
  return schema.parse(body)
}

/** Best-effort client IP for the audit log, behind a reverse proxy or not. */
export function clientIp(request: Request): string | undefined {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]?.trim()
  return request.headers.get('x-real-ip') ?? undefined
}
