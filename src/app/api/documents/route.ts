import { createHash } from 'node:crypto'

import { desc, eq, sql } from 'drizzle-orm'

import { HttpError, badRequest, clientIp, json, route, tooLarge } from '@/lib/api'
import { audit } from '@/lib/audit'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { documents } from '@/lib/db/schema'
import { env } from '@/lib/env'
import { detectFormat } from '@/lib/ingest/adapters'
import { ExtractionError } from '@/lib/ingest/types'
import { enqueue } from '@/lib/jobs/queue'
import { getStorage, storageKey } from '@/lib/storage'

export const runtime = 'nodejs'
/** Uploads must never be cached or statically evaluated. */
export const dynamic = 'force-dynamic'

export const GET = route(async () => {
  const user = await requireUser()

  const rows = await db
    .select({
      id: documents.id,
      title: documents.title,
      sourceType: documents.sourceType,
      sourceUrl: documents.sourceUrl,
      filename: documents.filename,
      byteSize: documents.byteSize,
      status: documents.status,
      error: documents.error,
      pageCount: documents.pageCount,
      chunkCount: documents.chunkCount,
      createdAt: documents.createdAt,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    // Scoped to the owner in the predicate, not filtered afterwards.
    .where(eq(documents.ownerId, user.id))
    .orderBy(desc(documents.createdAt))
    .limit(500)

  return json({ documents: rows })
})

export const POST = route(async (request: Request) => {
  const user = await requireUser()
  const maxBytes = env().MAX_UPLOAD_MB * 1024 * 1024

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    throw badRequest('Expected a multipart form upload.')
  }

  const file = form.get('file')
  if (!(file instanceof File)) throw badRequest('No file was included in the upload.')
  if (file.size === 0) throw badRequest('That file is empty.')
  if (file.size > maxBytes) {
    throw tooLarge(`That file is larger than the ${env().MAX_UPLOAD_MB} MB limit.`)
  }

  const buffer = Buffer.from(await file.arrayBuffer())

  // Reject an unsupported format now, while the user is still watching, rather
  // than letting the worker fail a minute later.
  let format
  try {
    format = detectFormat({ buffer, filename: file.name, mimeType: file.type })
  } catch (error) {
    if (error instanceof ExtractionError) throw badRequest(error.message)
    throw error
  }

  const contentHash = createHash('sha256').update(buffer).digest('hex')

  const existing = await db
    .select({ id: documents.id, title: documents.title })
    .from(documents)
    .where(sql`${documents.ownerId} = ${user.id} and ${documents.contentHash} = ${contentHash}`)
    .limit(1)

  if (existing.length > 0) {
    throw new HttpError(
      409,
      `You have already uploaded this file as "${existing[0].title}".`,
      'duplicate',
    )
  }

  const [created] = await db
    .insert(documents)
    .values({
      ownerId: user.id,
      title: file.name.replace(/\.[^.]+$/, '') || file.name,
      sourceType: format,
      filename: file.name,
      mimeType: file.type || null,
      byteSize: file.size,
      contentHash,
      status: 'pending',
    })
    .returning({ id: documents.id, title: documents.title })

  const key = storageKey(user.id, created.id, file.name)
  const storage = await getStorage()

  try {
    await storage.put(key, buffer, file.type || undefined)
  } catch (error) {
    // Do not leave a row pointing at a file that was never written.
    await db.delete(documents).where(eq(documents.id, created.id))
    throw error
  }

  await db.update(documents).set({ storageKey: key }).where(eq(documents.id, created.id))
  await enqueue('document.ingest', { documentId: created.id })

  await audit({
    actorId: user.id,
    action: 'document.uploaded',
    targetType: 'document',
    targetId: created.id,
    metadata: { filename: file.name, bytes: file.size, format },
    ipAddress: clientIp(request),
  })

  return json({ document: { id: created.id, title: created.title, status: 'pending' } }, { status: 201 })
})
