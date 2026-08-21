import { eq } from 'drizzle-orm'

import { db } from '@/lib/db'
import { chunks, documents } from '@/lib/db/schema'
import { getEmbeddings } from '@/lib/llm'
import { getStorage } from '@/lib/storage'
import { extract } from './adapters'
import { chunkDocument } from './chunk'
import { assemble } from './normalize'
import { ExtractionError } from './types'

/**
 * Embeddings are requested in batches so a 900-page manual becomes a sequence
 * of bounded calls rather than one request that times out. This is why large
 * documents do not need to be split by hand before uploading.
 */
const EMBED_BATCH = 64

async function setStatus(
  documentId: string,
  status: 'parsing' | 'chunking' | 'embedding' | 'ready' | 'failed',
  extra: Partial<typeof documents.$inferInsert> = {},
): Promise<void> {
  await db
    .update(documents)
    .set({ status, updatedAt: new Date(), ...extra })
    .where(eq(documents.id, documentId))
}

/**
 * Parse, chunk, embed, store. Runs in the worker, never in a request.
 *
 * Every failure path writes a message onto the document row, because a
 * document stuck at "processing" with no explanation is the single most
 * common complaint about tools like this.
 */
export async function ingestDocument(documentId: string): Promise<void> {
  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1)
  if (!doc) return // deleted while queued

  if (!doc.storageKey) {
    await setStatus(documentId, 'failed', { error: 'The original file is no longer available.' })
    return
  }

  try {
    await setStatus(documentId, 'parsing')

    const storage = await getStorage()
    const buffer = await storage.get(doc.storageKey)

    const { doc: extracted } = await extract({
      buffer,
      filename: doc.filename ?? undefined,
      mimeType: doc.mimeType ?? undefined,
      url: doc.sourceUrl ?? undefined,
    })

    const normalized = assemble(extracted)
    if (!normalized.text.trim()) {
      throw new ExtractionError('No readable text was found in that document.')
    }

    await setStatus(documentId, 'chunking', {
      // Prefer a real extracted title over the filename we guessed at upload.
      title: normalized.title || doc.title,
      pageCount: normalized.pageCount ?? null,
    })

    const prepared = chunkDocument(normalized)
    if (prepared.length === 0) {
      throw new ExtractionError('That document produced no indexable text.')
    }

    await setStatus(documentId, 'embedding')

    // Re-indexing replaces rather than appends. Doing this inside the same
    // transaction as the insert would hold a long write lock while we wait on
    // the embedding provider, so the delete happens first and the document is
    // already marked non-ready.
    await db.delete(chunks).where(eq(chunks.documentId, documentId))

    const embeddings = getEmbeddings()
    let written = 0

    for (let i = 0; i < prepared.length; i += EMBED_BATCH) {
      const batch = prepared.slice(i, i + EMBED_BATCH)
      const vectors = await embeddings.embed(batch.map((c) => c.content))

      await db.insert(chunks).values(
        batch.map((chunk, index) => ({
          documentId,
          ownerId: doc.ownerId,
          ordinal: i + index,
          content: chunk.content,
          tokenCount: chunk.tokenCount,
          locator: chunk.locator,
          embedding: vectors[index],
        })),
      )

      written += batch.length
      // Progress is visible to the user between batches, which is the whole
      // point of writing incrementally rather than at the end.
      await db
        .update(documents)
        .set({ chunkCount: written, updatedAt: new Date() })
        .where(eq(documents.id, documentId))
    }

    await setStatus(documentId, 'ready', { chunkCount: written, error: null })
  } catch (error) {
    const message =
      error instanceof ExtractionError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Ingestion failed.'

    await setStatus(documentId, 'failed', { error: message })
    // Rethrow so the queue records the attempt and applies backoff. Transient
    // provider failures are worth retrying; extraction failures will simply
    // exhaust their attempts and stay visible as failed.
    throw error
  }
}
