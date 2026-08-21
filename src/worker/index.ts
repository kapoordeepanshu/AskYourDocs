/**
 * Background worker.
 *
 * Ingestion runs here rather than in a route handler for two reasons: parsing
 * and embedding a large document takes far longer than any sensible request
 * timeout, and doing it in-process would tie up a web worker that should be
 * serving the interface.
 *
 * Run with: npm run worker
 */
import { pruneExpiredSessions } from '@/lib/auth/session'
import { client } from '@/lib/db'
import { ingestDocument } from '@/lib/ingest/pipeline'
import { claimJob, completeJob, enqueue, failJob, requeueStaleJobs } from '@/lib/jobs/queue'
import type { IngestPayload } from '@/lib/jobs/queue'

/** Poll interval when the queue is empty. */
const IDLE_MS = 2_000
/** Back off harder if the database itself is unreachable. */
const ERROR_MS = 10_000
const PRUNE_INTERVAL_MS = 60 * 60_000

let shuttingDown = false

function log(message: string, extra?: unknown) {
  const line = `[worker] ${new Date().toISOString()} ${message}`
  if (extra === undefined) process.stdout.write(`${line}\n`)
  else process.stdout.write(`${line} ${JSON.stringify(extra)}\n`)
}

async function handle(type: string, payload: unknown): Promise<void> {
  switch (type) {
    case 'document.ingest': {
      const { documentId } = payload as IngestPayload
      await ingestDocument(documentId)
      return
    }
    case 'sessions.prune': {
      const removed = await pruneExpiredSessions()
      if (removed > 0) log(`pruned ${removed} expired sessions`)
      return
    }
    default:
      throw new Error(`Unknown job type: ${type}`)
  }
}

async function tick(): Promise<'worked' | 'idle'> {
  const job = await claimJob()
  if (!job) return 'idle'

  const started = Date.now()
  log(`start ${job.type}`, { id: job.id, attempt: job.attempts })

  try {
    await handle(job.type, job.payload)
    await completeJob(job.id)
    log(`done ${job.type}`, { id: job.id, ms: Date.now() - started })
  } catch (error) {
    const { willRetry } = await failJob(job, error)
    log(`${willRetry ? 'retry' : 'failed'} ${job.type}`, {
      id: job.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  return 'worked'
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    // Do not hold the process open during shutdown.
    timer.unref?.()
  })

async function main() {
  log('starting')

  const requeued = await requeueStaleJobs()
  if (requeued > 0) log(`requeued ${requeued} jobs stranded by a previous run`)

  let lastPrune = 0

  while (!shuttingDown) {
    try {
      if (Date.now() - lastPrune > PRUNE_INTERVAL_MS) {
        lastPrune = Date.now()
        await enqueue('sessions.prune', {})
      }

      const result = await tick()
      // Only pause when there was nothing to do, so a backlog drains at full speed.
      if (result === 'idle') await sleep(IDLE_MS)
    } catch (error) {
      log('loop error', { error: error instanceof Error ? error.message : String(error) })
      await sleep(ERROR_MS)
    }
  }

  log('shutting down')
  await client.end({ timeout: 5 }).catch(() => {})
  process.exit(0)
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (shuttingDown) process.exit(1) // second signal: leave now
    log(`received ${signal}, finishing current job`)
    shuttingDown = true
  })
}

main().catch((error) => {
  log('fatal', { error: error instanceof Error ? error.message : String(error) })
  process.exit(1)
})
