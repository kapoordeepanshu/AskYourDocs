import { and, eq, lt, sql } from 'drizzle-orm'

import { db } from '@/lib/db'
import { jobs, type Job } from '@/lib/db/schema'

export type JobType = 'document.ingest' | 'sessions.prune'

export interface IngestPayload {
  documentId: string
}

export async function enqueue(
  type: JobType,
  payload: Record<string, unknown>,
  options: { maxAttempts?: number; runAt?: Date } = {},
): Promise<string> {
  const [job] = await db
    .insert(jobs)
    .values({
      type,
      payload,
      maxAttempts: options.maxAttempts ?? 3,
      runAt: options.runAt ?? new Date(),
    })
    .returning({ id: jobs.id })
  return job.id
}

/**
 * Claims one job atomically.
 *
 * FOR UPDATE SKIP LOCKED is what makes this safe to run from several worker
 * processes at once: each transaction takes a row nobody else holds, and no
 * worker blocks waiting for a row another one is already processing.
 */
export async function claimJob(): Promise<Job | null> {
  const rows = await db.execute<Job>(sql`
    update ${jobs}
    set status = 'running',
        started_at = now(),
        attempts = ${jobs.attempts} + 1
    where ${jobs.id} = (
      select ${jobs.id} from ${jobs}
      where ${jobs.status} = 'queued' and ${jobs.runAt} <= now()
      order by ${jobs.runAt} asc
      for update skip locked
      limit 1
    )
    returning *
  `)

  return (rows as unknown as Job[])[0] ?? null
}

export async function completeJob(id: string): Promise<void> {
  await db
    .update(jobs)
    .set({ status: 'succeeded', finishedAt: new Date(), lastError: null })
    .where(eq(jobs.id, id))
}

/**
 * Retries with exponential backoff, then gives up. A permanently failing job
 * stays in the table as a `failed` row so the admin console can show it rather
 * than the work vanishing silently.
 */
export async function failJob(job: Job, error: unknown): Promise<{ willRetry: boolean }> {
  const message = error instanceof Error ? error.message : String(error)
  const willRetry = job.attempts < job.maxAttempts

  if (willRetry) {
    const delayMs = Math.min(2 ** job.attempts * 5_000, 5 * 60_000)
    await db
      .update(jobs)
      .set({
        status: 'queued',
        lastError: message,
        runAt: new Date(Date.now() + delayMs),
      })
      .where(eq(jobs.id, job.id))
  } else {
    await db
      .update(jobs)
      .set({ status: 'failed', lastError: message, finishedAt: new Date() })
      .where(eq(jobs.id, job.id))
  }

  return { willRetry }
}

/**
 * Requeues jobs left in `running` by a worker that was killed mid-flight.
 * Called once at worker start: without it, a container restart during
 * ingestion would strand a document in `parsing` forever.
 */
export async function requeueStaleJobs(olderThanMs = 15 * 60_000): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs)
  const rows = await db
    .update(jobs)
    .set({ status: 'queued', runAt: new Date() })
    .where(and(eq(jobs.status, 'running'), lt(jobs.startedAt, cutoff)))
    .returning({ id: jobs.id })
  return rows.length
}
