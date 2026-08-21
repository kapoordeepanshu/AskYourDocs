import { sql } from 'drizzle-orm'

import { db } from '@/lib/db'
import type { ChunkLocator } from '@/lib/db/schema'
import { env } from '@/lib/env'
import { getEmbeddings } from '@/lib/llm'

export interface RetrievedChunk {
  chunkId: string
  documentId: string
  documentTitle: string
  sourceType: string
  sourceUrl: string | null
  content: string
  locator: ChunkLocator
  /** Cosine similarity, 0..1. Null when a chunk was found by keyword only. */
  similarity: number | null
  /** Fused rank score. Only meaningful relative to other results in this set. */
  score: number
}

/**
 * Reciprocal Rank Fusion constant. 60 is the value from the original TREC work
 * and is standard practice: large enough that the top few ranks do not
 * completely dominate, small enough that deep results still fall away.
 */
const RRF_K = 60

/** pgvector wants a bracketed literal, not a JSON array. */
function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`
}

/** Index signature satisfies db.execute's Record constraint. */
interface RawRow extends Record<string, unknown> {
  chunk_id: string
  document_id: string
  document_title: string
  source_type: string
  source_url: string | null
  content: string
  locator: ChunkLocator
  score: number
}

/**
 * Vector search alone reliably misses exact tokens: error codes, part numbers,
 * function names, a policy clause number. Keyword search alone misses every
 * paraphrase. Running both and fusing the ranks is the cheapest way to stop
 * losing either class of question.
 *
 * Both halves filter on owner_id inside the query. That is the isolation
 * boundary for the whole application.
 */
export async function retrieve(
  ownerId: string,
  query: string,
  options: { candidates?: number; documentIds?: string[] } = {},
): Promise<RetrievedChunk[]> {
  const limit = options.candidates ?? env().RETRIEVAL_CANDIDATES
  const trimmed = query.trim()
  if (!trimmed) return []

  const [queryVector] = await getEmbeddings().embed([trimmed])
  const vectorLiteral = toVectorLiteral(queryVector)

  // Optional scoping to a subset of documents, for "ask this document" flows.
  // Passed as a bound array parameter rather than interpolated: these ids come
  // from the request body, and owner_id alone should not be the only thing
  // standing between a caller and arbitrary SQL.
  const documentFilter =
    options.documentIds && options.documentIds.length > 0
      ? sql`and c.document_id = any(${options.documentIds}::uuid[])`
      : sql``

  const semantic = db.execute<RawRow>(sql`
    select
      c.id            as chunk_id,
      c.document_id   as document_id,
      d.title         as document_title,
      d.source_type   as source_type,
      d.source_url    as source_url,
      c.content       as content,
      c.locator       as locator,
      1 - (c.embedding <=> ${vectorLiteral}::vector) as score
    from chunks c
    join documents d on d.id = c.document_id
    where c.owner_id = ${ownerId}
      and d.status = 'ready'
      and c.embedding is not null
      ${documentFilter}
    order by c.embedding <=> ${vectorLiteral}::vector
    limit ${limit}
  `)

  // websearch_to_tsquery accepts what people actually type - quoted phrases,
  // OR, leading minus - without throwing on syntax the way to_tsquery does.
  const keyword = db.execute<RawRow>(sql`
    select
      c.id            as chunk_id,
      c.document_id   as document_id,
      d.title         as document_title,
      d.source_type   as source_type,
      d.source_url    as source_url,
      c.content       as content,
      c.locator       as locator,
      ts_rank_cd(c.search_vector, websearch_to_tsquery('english', ${trimmed})) as score
    from chunks c
    join documents d on d.id = c.document_id
    where c.owner_id = ${ownerId}
      and d.status = 'ready'
      and c.search_vector @@ websearch_to_tsquery('english', ${trimmed})
      ${documentFilter}
    order by score desc
    limit ${limit}
  `)

  const [semanticRows, keywordRows] = await Promise.all([semantic, keyword])

  return fuse(semanticRows as unknown as RawRow[], keywordRows as unknown as RawRow[], limit)
}

function fuse(semantic: RawRow[], keyword: RawRow[], limit: number): RetrievedChunk[] {
  const merged = new Map<string, RetrievedChunk>()

  const add = (rows: RawRow[], isSemantic: boolean) => {
    rows.forEach((row, index) => {
      const contribution = 1 / (RRF_K + index + 1)
      const existing = merged.get(row.chunk_id)

      if (existing) {
        existing.score += contribution
        // Similarity only ever comes from the vector arm.
        if (isSemantic) existing.similarity = Number(row.score)
        return
      }

      merged.set(row.chunk_id, {
        chunkId: row.chunk_id,
        documentId: row.document_id,
        documentTitle: row.document_title,
        sourceType: row.source_type,
        sourceUrl: row.source_url,
        content: row.content,
        locator: row.locator,
        similarity: isSemantic ? Number(row.score) : null,
        score: contribution,
      })
    })
  }

  add(semantic, true)
  add(keyword, false)

  return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, limit)
}

/**
 * The refusal gate.
 *
 * If nothing retrieved is semantically close to the question, the honest answer
 * is that it is not in the user's documents. Answering anyway is exactly how a
 * confident, well-cited, wrong answer gets produced.
 *
 * Keyword-only hits are deliberately not enough to pass: matching a word is not
 * the same as being about the question.
 */
export function hasUsableContext(results: RetrievedChunk[]): boolean {
  const floor = env().RETRIEVAL_MIN_SCORE
  return results.some((r) => r.similarity !== null && r.similarity >= floor)
}
