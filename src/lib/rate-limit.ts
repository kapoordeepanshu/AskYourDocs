import { lt, sql } from 'drizzle-orm'

import { db } from '@/lib/db'
import { rateLimits } from '@/lib/db/schema'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Counts one hit against `key` in a fixed window and reports whether it is
 * within `limit`.
 *
 * A single upsert, so two concurrent requests cannot both read the same count
 * and slip past the limit together. Fixed windows allow a burst of up to twice
 * the limit across a boundary, which is acceptable for keeping a public widget
 * from running up a model bill.
 */
export async function hit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<{ ok: boolean; retryAfterSeconds: number }> {
  const windowSeconds = Math.ceil(windowMs / 1000)
  const expired = sql`${rateLimits.windowStart} < now() - make_interval(secs => ${windowSeconds})`

  const rows = await db.execute<{ count: number; window_start: Date | string }>(sql`
    insert into ${rateLimits} (key, window_start, count)
    values (${key}, now(), 1)
    on conflict (key) do update set
      count = case when ${expired} then 1 else ${rateLimits.count} + 1 end,
      window_start = case when ${expired} then now() else ${rateLimits.windowStart} end
    returning count, window_start
  `)

  const row = (rows as unknown as { count: number; window_start: Date | string }[])[0]

  // Expired rows are dead weight. Sweep them now and then rather than on a
  // schedule, since there may be no worker running to do it.
  if (Math.random() < 0.01) {
    void db
      .delete(rateLimits)
      .where(lt(rateLimits.windowStart, new Date(Date.now() - 2 * DAY_MS)))
      .catch(() => {})
  }

  const elapsedMs = Date.now() - new Date(row.window_start).getTime()
  return {
    ok: Number(row.count) <= limit,
    retryAfterSeconds: Math.max(1, Math.ceil((windowMs - elapsedMs) / 1000)),
  }
}
