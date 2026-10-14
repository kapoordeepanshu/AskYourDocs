import { after } from 'next/server'

import { env } from '@/lib/env'
import { ingestDocument } from '@/lib/ingest/pipeline'
import { enqueue } from './queue'

/**
 * Starts ingestion for a document the caller has just stored.
 *
 * In `worker` mode this only queues a job. In `inline` mode, for hosts with no
 * long-running process, the work runs in this same function invocation after
 * the response has been sent, so the upload still returns immediately and the
 * documents page polls for progress exactly as it does with a worker.
 *
 * Inline mode has no retry. A failure is written onto the document row by the
 * pipeline, and the owner can re-index from the documents page.
 */
export async function scheduleIngest(documentId: string): Promise<void> {
  if (env().INGEST_MODE === 'worker') {
    await enqueue('document.ingest', { documentId })
    return
  }

  after(async () => {
    try {
      await ingestDocument(documentId)
    } catch (error) {
      console.error('[ingest]', documentId, error)
    }
  })
}
