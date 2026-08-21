import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import { env } from '@/lib/env'
import * as schema from './schema'

declare global {
  // Next.js dev hot-reloads modules; without this the pool is recreated on
  // every edit until Postgres refuses new connections.
  // eslint-disable-next-line no-var
  var __askyourdocs_sql: ReturnType<typeof postgres> | undefined
}

function client() {
  return postgres(env().DATABASE_URL, {
    max: env().NODE_ENV === 'production' ? 10 : 4,
    idle_timeout: 20,
    connect_timeout: 10,
  })
}

/**
 * Named `client`, not `sql`: an export called `sql` here shadows drizzle-orm's
 * `sql` template tag at every call site that imports both, and the resulting
 * failure (`query.getSQL is not a function`) points nowhere useful.
 */
const client_ = globalThis.__askyourdocs_sql ?? client()
if (env().NODE_ENV !== 'production') globalThis.__askyourdocs_sql = client_

export const db = drizzle(client_, { schema })
export { client_ as client, schema }
export type Db = typeof db
