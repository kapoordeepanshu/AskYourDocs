import type { ChunkLocator } from '@/lib/db/schema'
import { env } from '@/lib/env'
import type { NormalizedDoc, PositionedBlock } from './types'

/**
 * Token estimate without pulling in a tokeniser.
 *
 * A real BPE count would need a per-model vocabulary, and every model this app
 * supports tokenises differently, so an exact count for one is wrong for the
 * others. Four characters per token is close enough for English prose, and the
 * consequence of being off is a slightly smaller or larger chunk, not a
 * failure. Uses the larger of the character and word estimates so that
 * identifier-heavy technical text is not badly underestimated.
 */
export function estimateTokens(text: string): number {
  const byChars = text.length / 4
  const byWords = (text.match(/\S+/g)?.length ?? 0) * 1.3
  return Math.ceil(Math.max(byChars, byWords))
}

export interface PreparedChunk {
  content: string
  tokenCount: number
  locator: ChunkLocator
}

interface Sentence {
  text: string
  charStart: number
  charEnd: number
  page?: number
  heading?: string
  anchor?: string
}

/**
 * Splits on sentence-ending punctuation followed by whitespace and a capital.
 * Known abbreviations are excluded so "See Fig. 4" does not become two
 * sentences. Perfect segmentation is not required: this only decides where a
 * chunk may be cut, and a slightly odd cut costs a little retrieval quality,
 * not correctness.
 */
const ABBREVIATIONS =
  /\b(?:[A-Z]|Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e|Fig|No|Vol|Sec|approx|Inc|Ltd|Co)\.$/

function splitSentences(block: PositionedBlock): Sentence[] {
  const { text } = block
  const sentences: Sentence[] = []
  let start = 0

  const boundary = /([.!?])(["')\]]*)(\s+)/g
  let match: RegExpExecArray | null

  while ((match = boundary.exec(text)) !== null) {
    const end = match.index + match[1].length + match[2].length
    const candidate = text.slice(start, end)
    if (ABBREVIATIONS.test(candidate.trimEnd())) continue

    sentences.push(makeSentence(block, candidate, start, end))
    start = boundary.lastIndex
  }

  if (start < text.length) {
    sentences.push(makeSentence(block, text.slice(start), start, text.length))
  }

  return sentences.filter((s) => s.text.length > 0)
}

function makeSentence(
  block: PositionedBlock,
  raw: string,
  relStart: number,
  relEnd: number,
): Sentence {
  return {
    text: raw.trim(),
    charStart: block.charStart + relStart,
    charEnd: block.charStart + relEnd,
    page: block.page,
    heading: block.heading,
    anchor: block.anchor,
  }
}

/**
 * A single sentence longer than the chunk budget (a table row, a minified
 * blob, a wall of text with no punctuation) still has to fit, so fall back to
 * hard-splitting on a character budget.
 */
function hardSplit(sentence: Sentence, maxTokens: number): Sentence[] {
  const maxChars = maxTokens * 4
  if (sentence.text.length <= maxChars) return [sentence]

  const parts: Sentence[] = []
  for (let offset = 0; offset < sentence.text.length; offset += maxChars) {
    const slice = sentence.text.slice(offset, offset + maxChars)
    parts.push({
      ...sentence,
      text: slice,
      charStart: sentence.charStart + offset,
      charEnd: sentence.charStart + offset + slice.length,
    })
  }
  return parts
}

export function chunkDocument(doc: NormalizedDoc): PreparedChunk[] {
  const maxTokens = env().CHUNK_SIZE_TOKENS
  const overlapTokens = env().CHUNK_OVERLAP_TOKENS

  const sentences = doc.blocks
    .flatMap(splitSentences)
    .flatMap((s) => hardSplit(s, maxTokens))

  const chunks: PreparedChunk[] = []
  let current: Sentence[] = []
  let currentTokens = 0

  const flush = () => {
    if (current.length === 0) return

    const first = current[0]
    const last = current[current.length - 1]
    const content = current.map((s) => s.text).join(' ')

    chunks.push({
      content,
      tokenCount: estimateTokens(content),
      locator: {
        charStart: first.charStart,
        charEnd: last.charEnd,
        ...(first.page !== undefined ? { page: first.page } : {}),
        ...(first.heading ? { heading: first.heading } : {}),
        ...(first.anchor ? { anchor: first.anchor } : {}),
      },
    })
  }

  /**
   * Overlap exists so a fact split across a chunk boundary is still retrievable
   * whole from at least one side. Carried as complete sentences rather than a
   * fixed character count, because half a sentence embeds poorly.
   */
  const overlapTail = (): Sentence[] => {
    if (overlapTokens <= 0) return []
    const tail: Sentence[] = []
    let tokens = 0
    for (let i = current.length - 1; i >= 0; i--) {
      const cost = estimateTokens(current[i].text)
      if (tokens + cost > overlapTokens) break
      tail.unshift(current[i])
      tokens += cost
    }
    // Never carry the entire chunk forward: that would loop forever on a
    // document made of one long sentence per chunk.
    return tail.length === current.length ? tail.slice(1) : tail
  }

  for (const sentence of sentences) {
    const cost = estimateTokens(sentence.text)

    if (currentTokens + cost > maxTokens && current.length > 0) {
      flush()
      current = overlapTail()
      currentTokens = current.reduce((sum, s) => sum + estimateTokens(s.text), 0)
    }

    // Starting a fresh chunk with a page or heading change keeps citations
    // honest: a chunk that spans two pages can only cite one of them.
    const first = current[0]
    if (first && sentence.page !== undefined && first.page !== sentence.page) {
      flush()
      current = []
      currentTokens = 0
    }

    current.push(sentence)
    currentTokens += cost
  }

  flush()

  return chunks.filter((c) => c.content.trim().length > 0)
}
