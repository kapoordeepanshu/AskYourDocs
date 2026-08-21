/**
 * End-to-end smoke test against the real database.
 * Exercises the parts that only fail once SQL actually runs: the tsvector
 * trigger, the HNSW index, hybrid retrieval, and owner isolation.
 */
import { eq, sql } from 'drizzle-orm'

import { client, db } from '@/lib/db'
import { chunks, documents, users } from '@/lib/db/schema'
import { hashPassword } from '@/lib/auth/password'
import { retrieveWithVector } from '@/lib/rag/retrieve'

const DIMS = 1536

/** Deterministic pseudo-embedding: no provider needed to test the SQL path. */
function fakeVector(seed: number): number[] {
  const out = new Array<number>(DIMS)
  let x = seed * 9301 + 49297
  for (let i = 0; i < DIMS; i++) {
    x = (x * 9301 + 49297) % 233280
    out[i] = (x / 233280) * 2 - 1
  }
  const norm = Math.hypot(...out)
  return out.map((v) => v / norm)
}

async function main() {
  const results: string[] = []
  const check = (name: string, ok: boolean, detail = '') => {
    results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
    return ok
  }

  // Two users, so isolation can actually be tested.
  const [alice] = await db
    .insert(users)
    .values({ email: `alice-${Date.now()}@test.local`, passwordHash: await hashPassword('password-1234'), role: 'admin' })
    .returning({ id: users.id })
  const [bob] = await db
    .insert(users)
    .values({ email: `bob-${Date.now()}@test.local`, passwordHash: await hashPassword('password-1234') })
    .returning({ id: users.id })

  const [aliceDoc] = await db
    .insert(documents)
    .values({ ownerId: alice.id, title: 'Alice handbook', sourceType: 'pdf', status: 'ready' })
    .returning({ id: documents.id })
  const [bobDoc] = await db
    .insert(documents)
    .values({ ownerId: bob.id, title: 'Bob handbook', sourceType: 'pdf', status: 'ready' })
    .returning({ id: documents.id })

  await db.insert(chunks).values([
    {
      documentId: aliceDoc.id,
      ownerId: alice.id,
      ordinal: 0,
      content: 'Refund requests must be submitted within 30 days. Error code ERR_REFUND_9931 indicates a rejected claim.',
      tokenCount: 20,
      locator: { charStart: 0, charEnd: 100, page: 1 },
      embedding: fakeVector(1),
    },
    {
      documentId: aliceDoc.id,
      ownerId: alice.id,
      ordinal: 1,
      content: 'Holiday entitlement is 25 days per year, accrued monthly.',
      tokenCount: 12,
      locator: { charStart: 101, charEnd: 160, page: 2 },
      embedding: fakeVector(2),
    },
    {
      documentId: bobDoc.id,
      ownerId: bob.id,
      ordinal: 0,
      content: 'Refund requests must be submitted within 30 days under Bob policy ERR_REFUND_9931.',
      tokenCount: 16,
      locator: { charStart: 0, charEnd: 90, page: 1 },
      embedding: fakeVector(1),
    },
  ])

  // 1. The trigger must have populated search_vector without app code touching it.
  //    Scoped to this run's rows: the table may hold data from other runs.
  const tsv = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from chunks
    where owner_id in (${alice.id}::uuid, ${bob.id}::uuid) and search_vector is not null
  `)
  check(
    'tsvector trigger populates search_vector',
    (tsv as unknown as { n: number }[])[0].n === 3,
    `${(tsv as unknown as { n: number }[])[0].n} of 3 populated`,
  )

  // 2. Keyword arm: an exact identifier must be findable.
  const keyword = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from chunks
    where owner_id = ${alice.id}
      and search_vector @@ websearch_to_tsquery('english', 'ERR_REFUND_9931')
  `)
  check(
    'full-text finds an exact identifier',
    (keyword as unknown as { n: number }[])[0].n === 1,
  )

  // 3. The HNSW index must exist and be valid.
  //    Not asserted via EXPLAIN: on a table this small the planner correctly
  //    prefers a sequential scan, so a plan check would only prove the table
  //    is tiny. Index existence is the invariant that actually matters here.
  const idx = await db.execute<{ indexdef: string }>(sql`
    select indexdef from pg_indexes
    where tablename = 'chunks' and indexname = 'chunks_embedding_hnsw_idx'
  `)
  const indexDef = (idx as unknown as { indexdef: string }[])[0]?.indexdef ?? ''
  check(
    'HNSW index exists with cosine ops',
    /using hnsw/i.test(indexDef) && /vector_cosine_ops/i.test(indexDef),
    indexDef.slice(0, 90),
  )

  const ginIdx = await db.execute<{ indexdef: string }>(sql`
    select indexdef from pg_indexes
    where tablename = 'chunks' and indexname = 'chunks_search_vector_idx'
  `)
  check(
    'GIN index exists on search_vector',
    /using gin/i.test((ginIdx as unknown as { indexdef: string }[])[0]?.indexdef ?? ''),
  )

  // 4. Hybrid retrieval, scoped to Alice, must never return Bob's chunk.
  const aliceResults = await retrieveWithVector(alice.id, 'refund window ERR_REFUND_9931', fakeVector(1))
  const leaked = aliceResults.filter((r) => r.documentId === bobDoc.id)
  check('hybrid retrieval returns results', aliceResults.length > 0, `${aliceResults.length} hits`)
  check('owner isolation holds in retrieval', leaked.length === 0, `${leaked.length} leaked`)

  // 5. Bob sees only his own, despite identical text.
  const bobResults = await retrieveWithVector(bob.id, 'refund window ERR_REFUND_9931', fakeVector(1))
  check(
    'the other user sees only their own copy',
    bobResults.length > 0 && bobResults.every((r) => r.documentId === bobDoc.id),
  )

  // 6. Deleting the user cascades to documents and chunks.
  await db.delete(users).where(eq(users.id, bob.id))
  const remaining = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from chunks where owner_id = ${bob.id}`,
  )
  check('user delete cascades to chunks', (remaining as unknown as { n: number }[])[0].n === 0)

  await db.delete(users).where(eq(users.id, alice.id))

  process.stdout.write(results.join('\n') + '\n')
  await client.end()
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0)
}

main().catch(async (error) => {
  process.stderr.write(`smoke test threw: ${error?.message ?? error}\n${error?.stack ?? ''}\n`)
  await client.end({ timeout: 5 }).catch(() => {})
  process.exit(1)
})
