import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import { clientIp, json, notFound, route } from '@/lib/api'
import { audit } from '@/lib/audit'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { documents } from '@/lib/db/schema'
import { enqueue } from '@/lib/jobs/queue'
import { getStorage } from '@/lib/storage'

export const runtime = 'nodejs'

const paramsSchema = z.object({ id: z.string().uuid() })

type Context = { params: Promise<{ id: string }> }

/**
 * Every handler here matches on `id AND ownerId`. Looking the document up by id
 * and then comparing the owner in JavaScript would work too, right up until
 * someone adds an early return above the check.
 */
export const GET = route(async (_request: Request, context: Context) => {
  const user = await requireUser()
  const { id } = paramsSchema.parse(await context.params)

  const [doc] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.ownerId, user.id)))
    .limit(1)

  if (!doc) throw notFound('That document does not exist.')

  return json({
    document: {
      id: doc.id,
      title: doc.title,
      sourceType: doc.sourceType,
      sourceUrl: doc.sourceUrl,
      filename: doc.filename,
      byteSize: doc.byteSize,
      status: doc.status,
      error: doc.error,
      pageCount: doc.pageCount,
      chunkCount: doc.chunkCount,
      fetchedAt: doc.fetchedAt,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    },
  })
})

export const DELETE = route(async (request: Request, context: Context) => {
  const user = await requireUser()
  const { id } = paramsSchema.parse(await context.params)

  const [doc] = await db
    .delete(documents)
    .where(and(eq(documents.id, id), eq(documents.ownerId, user.id)))
    .returning({ id: documents.id, title: documents.title, storageKey: documents.storageKey })

  if (!doc) throw notFound('That document does not exist.')

  // Chunks and citations cascade from the row delete. The stored original does
  // not, so remove it here; a failure must not resurrect the document.
  if (doc.storageKey) {
    try {
      await (await getStorage()).delete(doc.storageKey)
    } catch (error) {
      console.error('[storage] orphaned object', doc.storageKey, error)
    }
  }

  await audit({
    actorId: user.id,
    action: 'document.deleted',
    targetType: 'document',
    targetId: doc.id,
    metadata: { title: doc.title },
    ipAddress: clientIp(request),
  })

  return json({ ok: true })
})

/** Re-runs the pipeline against the stored original, replacing every chunk. */
export const POST = route(async (request: Request, context: Context) => {
  const user = await requireUser()
  const { id } = paramsSchema.parse(await context.params)

  const [doc] = await db
    .select({ id: documents.id, storageKey: documents.storageKey })
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.ownerId, user.id)))
    .limit(1)

  if (!doc) throw notFound('That document does not exist.')
  if (!doc.storageKey) throw notFound('The original file is no longer available to re-index.')

  await db
    .update(documents)
    .set({ status: 'pending', error: null, chunkCount: 0, updatedAt: new Date() })
    .where(eq(documents.id, doc.id))

  await enqueue('document.ingest', { documentId: doc.id })

  await audit({
    actorId: user.id,
    action: 'document.reindexed',
    targetType: 'document',
    targetId: doc.id,
    ipAddress: clientIp(request),
  })

  return json({ ok: true })
})
