import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import { env } from '@/lib/env'
import * as schema from './schema'

declare global {
  // Next.js dev hot-reloads modules; without this the pool is recreated on
  // every edit until Postgres refuses new connections.
  // eslint-disable-next-line no-var
  var __askyourdocs_sql: ReturnType<typeof postgres> | undefined
}

type Client = ReturnType<typeof postgres>
export type Db = PostgresJsDatabase<typeof schema>

let cachedClient: Client | undefined
let cachedDb: Db | undefined

/**
 * Connecting is deferred until the first query.
 *
 * `next build` imports every route module to collect page data. If the pool
 * were opened at import time, a build would demand DATABASE_URL and
 * SESSION_SECRET, which means either baking placeholder secrets into the image
 * or being unable to build one at all. Nothing here should need a running
 * database to compile.
 */
function getClient(): Client {
  if (!cachedClient) {
    cachedClient =
      globalThis.__askyourdocs_sql ??
      postgres(env().DATABASE_URL, {
        max: env().NODE_ENV === 'production' ? 10 : 4,
        idle_timeout: 20,
        connect_timeout: 10,
        // DROP ... IF EXISTS in the custom migrations raises harmless notices.
        onnotice: () => {},
      })

    if (env().NODE_ENV !== 'production') globalThis.__askyourdocs_sql = cachedClient
  }
  return cachedClient
}

function getDb(): Db {
  cachedDb ??= drizzle(getClient(), { schema })
  return cachedDb
}

/**
 * Proxies so call sites keep the plain `db.select(...)` and `client.end()`
 * ergonomics while the real objects are built on first use.
 */
export const db = new Proxy({} as Db, {
  get: (_target, property, receiver) => Reflect.get(getDb(), property, receiver),
})

/**
 * Property access only. postgres.js is normally callable as a template tag,
 * but nothing here uses it that way, and a proxy over a plain object cannot
 * forward a call. Use drizzle's `sql` tag for queries and this for lifecycle
 * calls like `client.end()` and `client.unsafe()`.
 */
export const client = new Proxy({} as Client, {
  get: (_target, property, receiver) => Reflect.get(getClient(), property, receiver),
})

export { schema }
