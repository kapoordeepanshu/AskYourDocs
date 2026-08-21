import type { RetrievedChunk } from './retrieve'

/**
 * The answer prompt.
 *
 * Two rules carry the whole product:
 *
 *   1. Every sentence must carry a citation. Without a per-sentence marker
 *      there is nothing to verify against later, and a single trailing [1] on
 *      a five-sentence paragraph is exactly the shape a citation-shaped
 *      hallucination takes.
 *   2. Refusing is an acceptable answer. Models default to being helpful, which
 *      here means inventing a bridge between loosely related passages, so
 *      permission to refuse has to be explicit and repeated.
 */
export const ANSWER_SYSTEM = `You answer questions using ONLY the numbered passages provided. The passages come from documents the user uploaded themselves.

RULES

1. Every factual sentence must end with a citation marker naming the passage it
   came from, like [3]. If a sentence draws on two passages, cite both: [2][5].
2. Never state anything the passages do not say. Do not fill gaps with general
   knowledge, and do not infer beyond what is written.
3. If the passages do not contain the answer, say so plainly in one sentence and
   stop. Do not speculate, and do not offer a partial answer built on guesses.
   A refusal needs no citation.
4. If the passages partly answer the question, answer that part, cite it, and
   say explicitly what is missing.
5. If passages contradict each other, say so and cite both.
6. Quote exact wording for definitions, figures, thresholds, names, and dates.
   Do not round numbers or paraphrase a legal or policy clause.
7. Write plainly. No preamble, no restating the question, no closing summary.
   Short paragraphs, or a list when the answer is genuinely a list.

Cite the passage number as shown. Never invent a passage number.`

/** Numbering is 1-based to match the prompt; index 0 is passage [1]. */
export function buildContext(chunks: RetrievedChunk[]): string {
  return chunks
    .map((chunk, index) => {
      const location = describeLocation(chunk)
      const header = location
        ? `[${index + 1}] ${chunk.documentTitle} — ${location}`
        : `[${index + 1}] ${chunk.documentTitle}`
      return `${header}\n${chunk.content}`
    })
    .join('\n\n---\n\n')
}

export function describeLocation(chunk: RetrievedChunk): string | null {
  if (chunk.locator.page !== undefined) return `page ${chunk.locator.page}`
  if (chunk.locator.heading) return chunk.locator.heading
  return null
}

export function buildUserTurn(question: string, chunks: RetrievedChunk[]): string {
  return `Passages:

${buildContext(chunks)}

---

Question: ${question}`
}

/**
 * Conversation history is included so follow-ups like "what about the second
 * one?" resolve, but it is capped: old turns push the passages further from
 * the question, and the passages are what the answer must come from.
 */
export const MAX_HISTORY_TURNS = 6

export const REFUSAL_TEXT =
  "I could not find anything in your documents that answers that. Try rephrasing the question, or upload a document that covers it."

/** A short conversation title generated from the first question. */
export const TITLE_SYSTEM = `Write a title of at most six words for a conversation that starts with the question below. Use plain nouns, no quotes, no trailing punctuation. Reply with the title only.`
