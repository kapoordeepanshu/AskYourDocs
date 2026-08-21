import { json, route } from '@/lib/api'
import { requireUser } from '@/lib/auth'
import { describeLocation } from '@/lib/rag/prompt'
import { retrieve } from '@/lib/rag/retrieve'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Search shares the retrieval path with chat, minus the generation. Same hybrid
 * query, same owner scoping, so what search shows is exactly what an answer
 * would have been built from. Divergence between the two would make search
 * useless for debugging a bad answer.
 */
export const GET = route(async (request: Request) => {
  const user = await requireUser()

  const query = new URL(request.url).searchParams.get('q')?.trim() ?? ''
  if (!query) return json({ query: '', results: [] })

  const results = await retrieve(user.id, query, { candidates: 25 })

  return json({
    query,
    results: results.map((chunk) => ({
      chunkId: chunk.chunkId,
      documentId: chunk.documentId,
      documentTitle: chunk.documentTitle,
      sourceType: chunk.sourceType,
      sourceUrl: chunk.sourceUrl,
      location: describeLocation(chunk),
      similarity: chunk.similarity,
      excerpt: chunk.content.slice(0, 400),
    })),
  })
})
