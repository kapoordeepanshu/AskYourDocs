import { env } from '@/lib/env'
import { getLlm } from '@/lib/llm'
import type { RetrievedChunk } from './retrieve'

/** Enough to judge relevance without paying for the whole passage. */
const SNIPPET_CHARS = 500

const SYSTEM = `You rank passages by how well they answer a question.

Judge only whether a passage contains information that helps answer the question.
Ignore writing quality, length, and how authoritative the passage sounds.

A passage that merely mentions the same topic is NOT relevant. A passage is
relevant only if a person could use it to answer some part of the question.

Reply with a JSON array of passage numbers, most relevant first, containing only
the passages that are genuinely relevant. Reply with [] if none are.
Reply with the array and nothing else.`

/**
 * Reranking with the chat model rather than a cross-encoder.
 *
 * A dedicated reranker would be better and faster, but it means shipping a
 * model, which breaks the promise that this runs with nothing but Postgres and
 * whatever LLM you already have. This costs one extra call and reliably pushes
 * near-duplicate boilerplate below the passage that actually answers.
 *
 * Any failure returns the fused order unchanged: reranking is an improvement,
 * never a dependency.
 */
export async function rerank(
  question: string,
  candidates: RetrievedChunk[],
  topK: number,
): Promise<RetrievedChunk[]> {
  if (!env().RERANK_ENABLED || candidates.length <= 1) {
    return candidates.slice(0, topK)
  }

  const listing = candidates
    .map((chunk, index) => {
      const snippet = chunk.content.slice(0, SNIPPET_CHARS)
      const truncated = chunk.content.length > SNIPPET_CHARS ? '…' : ''
      return `[${index + 1}] (${chunk.documentTitle})\n${snippet}${truncated}`
    })
    .join('\n\n')

  try {
    const { text } = await getLlm().complete(
      [{ role: 'user', content: `Question: ${question}\n\nPassages:\n\n${listing}` }],
      { system: SYSTEM, temperature: 0, maxTokens: 200 },
    )

    const order = parseRanking(text, candidates.length)
    if (order.length === 0) return candidates.slice(0, topK)

    const ranked = order.map((index) => candidates[index])

    // The model is allowed to drop passages, but if it drops nearly everything
    // it has probably misread the task. Backfill from the fused order so a
    // conservative reranker cannot starve the answer of context.
    if (ranked.length < Math.min(topK, candidates.length)) {
      const chosen = new Set(ranked.map((c) => c.chunkId))
      for (const candidate of candidates) {
        if (ranked.length >= topK) break
        if (!chosen.has(candidate.chunkId)) ranked.push(candidate)
      }
    }

    return ranked.slice(0, topK)
  } catch {
    return candidates.slice(0, topK)
  }
}

/**
 * Models wrap JSON in prose, fences, or explanation no matter how firmly you
 * ask them not to. Pull the first array out of the response rather than
 * trusting the whole string to parse.
 */
function parseRanking(text: string, count: number): number[] {
  const match = /\[[\s\S]*?\]/.exec(text)
  if (!match) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(match[0])
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  const seen = new Set<number>()
  const order: number[] = []

  for (const entry of parsed) {
    const value = typeof entry === 'number' ? entry : Number(entry)
    if (!Number.isInteger(value)) continue
    const index = value - 1 // the prompt is 1-based
    if (index < 0 || index >= count || seen.has(index)) continue
    seen.add(index)
    order.push(index)
  }

  return order
}
