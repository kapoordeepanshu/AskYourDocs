import { createHash } from 'node:crypto'

import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'

import { HttpError, badRequest, clientIp, json, parseJson, route } from '@/lib/api'
import { audit } from '@/lib/audit'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { documents } from '@/lib/db/schema'
import { UnsafeUrlError, fetchSafely } from '@/lib/ingest/fetch-safe'
import { scheduleIngest } from '@/lib/jobs/dispatch'
import { getStorage, storageKey } from '@/lib/storage'

export const runtime = 'nodejs'
/** Only matters with INGEST_MODE=inline, where ingestion runs after the response. */
export const maxDuration = 300
export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  url: z.string().trim().min(1, 'Enter a URL.'),
})

export const POST = route(async (request: Request) => {
  const user = await requireUser()
  const { url } = await parseJson(request, bodySchema)

  // Fetched here rather than in the worker so the user learns immediately that
  // a URL is unreachable, blocked, or the wrong content type. Only the slow
  // part (parse, chunk, embed) is deferred.
  let fetched
  try {
    fetched = await fetchSafely(url)
  } catch (error) {
    if (error instanceof UnsafeUrlError) throw badRequest(error.message)
    throw error
  }

  const contentHash = createHash('sha256').update(fetched.body).digest('hex')

  const existing = await db
    .select({ id: documents.id, title: documents.title })
    .from(documents)
    .where(sql`${documents.ownerId} = ${user.id} and ${documents.contentHash} = ${contentHash}`)
    .limit(1)

  if (existing.length > 0) {
    throw new HttpError(
      409,
      `That page has not changed since you imported it as "${existing[0].title}".`,
      'duplicate',
    )
  }

  const filename = filenameFromUrl(fetched.url, fetched.contentType)

  const [created] = await db
    .insert(documents)
    .values({
      ownerId: user.id,
      // Replaced with the real page title once extraction runs.
      title: fetched.url,
      sourceType: 'url',
      sourceUrl: fetched.url,
      filename,
      mimeType: fetched.contentType,
      byteSize: fetched.body.length,
      contentHash,
      status: 'pending',
      fetchedAt: new Date(),
    })
    .returning({ id: documents.id })

  const key = storageKey(user.id, created.id, filename)
  const storage = await getStorage()

  try {
    await storage.put(key, fetched.body, fetched.contentType)
  } catch (error) {
    await db.delete(documents).where(eq(documents.id, created.id))
    throw error
  }

  await db.update(documents).set({ storageKey: key }).where(eq(documents.id, created.id))
  await scheduleIngest(created.id)

  await audit({
    actorId: user.id,
    action: 'document.url_ingested',
    targetType: 'document',
    targetId: created.id,
    metadata: { url: fetched.url, bytes: fetched.body.length },
    ipAddress: clientIp(request),
  })

  return json(
    { document: { id: created.id, title: fetched.url, status: 'pending' } },
    { status: 201 },
  )
})

/** Storage keys want a stable, meaningful filename with the right extension. */
function filenameFromUrl(url: string, contentType: string): string {
  const extension = contentType === 'application/pdf' ? 'pdf' : 'html'
  try {
    const parsed = new URL(url)
    const last = parsed.pathname.split('/').filter(Boolean).pop()
    const base = (last ?? parsed.hostname).replace(/\.[^.]+$/, '')
    return `${base || parsed.hostname}.${extension}`
  } catch {
    return `page.${extension}`
  }
}
