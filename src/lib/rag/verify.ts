import { getLlm } from '@/lib/llm'
import type { AnswerSentence } from './citations'
import { citedSentences, stripCitations, uncitedSentences } from './citations'
import type { RetrievedChunk } from './retrieve'

export type Verdict = 'supported' | 'partial' | 'unsupported' | 'unchecked'

export interface CitationCheck {
  sentenceIndex: number
  sentence: string
  /** 1-based passage number as cited in the answer. */
  passage: number
  chunkId: string | null
  documentId: string | null
  verdict: Verdict
  reason: string | null
}

export interface VerificationResult {
  checks: CitationCheck[]
  /** Percentage of cited claims that held up, 0-100. Null if nothing was checkable. */
  groundingScore: number | null
  /** Sentences that asserted something without citing anything. */
  uncitedCount: number
}

/**
 * Pairs are batched so a long answer costs a handful of calls rather than one
 * per sentence. Kept small because accuracy degrades once a judging prompt has
 * too much to hold at once.
 */
const BATCH_SIZE = 6

const SYSTEM = `You check whether a passage supports a claim. You are the last line of defence against a confident answer that cites a source which does not actually say what was claimed.

For each numbered item you are given a CLAIM and the PASSAGE it cites. Decide:

- "supported"   - the passage states the claim, or states it in different words.
- "partial"     - the passage supports part of the claim, but some detail in the
                  claim (a number, a name, a condition, a qualifier) is not in
                  the passage.
- "unsupported" - the passage does not state the claim. This includes claims
                  that are plausible, true in general, or merely on the same
                  topic as the passage.

Judge ONLY against the passage text. Your own knowledge is irrelevant here: a
claim you know to be true is still "unsupported" if this passage does not say it.
When you are unsure, choose "unsupported".

Reply with a JSON array, one object per item, in the same order:
[{"n":1,"verdict":"supported","reason":"..."}]

Keep each reason under 15 words, naming what is missing when it is not supported.
Reply with the JSON array and nothing else.`

/**
 * Checks every cited sentence against the passage it cites.
 *
 * This is the step that separates a citation from a decoration. A model asked
 * to cite its sources will happily attach [2] to a sentence that passage 2 does
 * not support, and readers trust the marker precisely because they do not
 * re-read the source. So the marker gets checked before they see it.
 *
 * On failure everything is returned as "unchecked" rather than "supported":
 * the interface must never imply a claim was validated when the check did not
 * actually run.
 */
export async function verifyAnswer(
  sentences: AnswerSentence[],
  chunks: RetrievedChunk[],
): Promise<VerificationResult> {
  const cited = citedSentences(sentences)
  const uncitedCount = uncitedSentences(sentences).length

  const pairs: CitationCheck[] = []
  for (const sentence of cited) {
    for (const passage of sentence.passages) {
      const chunk = chunks[passage - 1]
      pairs.push({
        sentenceIndex: sentence.index,
        sentence: stripCitations(sentence.text),
        passage,
        chunkId: chunk?.chunkId ?? null,
        documentId: chunk?.documentId ?? null,
        // A citation pointing at a passage that was never provided is
        // fabricated on its face; no model call needed.
        verdict: chunk ? 'unchecked' : 'unsupported',
        reason: chunk ? null : 'Cites a passage that was not provided.',
      })
    }
  }

  const checkable = pairs.filter((p) => p.chunkId !== null)
  if (checkable.length === 0) {
    return { checks: pairs, groundingScore: scoreOf(pairs), uncitedCount }
  }

  for (let i = 0; i < checkable.length; i += BATCH_SIZE) {
    const batch = checkable.slice(i, i + BATCH_SIZE)
    await judgeBatch(batch, chunks)
  }

  return { checks: pairs, groundingScore: scoreOf(pairs), uncitedCount }
}

async function judgeBatch(batch: CitationCheck[], chunks: RetrievedChunk[]): Promise<void> {
  const body = batch
    .map((check, index) => {
      const chunk = chunks[check.passage - 1]
      return `ITEM ${index + 1}\nCLAIM: ${check.sentence}\nPASSAGE: ${chunk.content}`
    })
    .join('\n\n---\n\n')

  try {
    const { text } = await getLlm().complete([{ role: 'user', content: body }], {
      system: SYSTEM,
      temperature: 0,
      maxTokens: 700,
    })

    const verdicts = parseVerdicts(text)
    for (const [index, check] of batch.entries()) {
      const parsed = verdicts.get(index + 1)
      if (!parsed) continue
      check.verdict = parsed.verdict
      check.reason = parsed.reason
    }
  } catch {
    // Leave the batch as "unchecked". Reported honestly rather than assumed good.
  }
}

function parseVerdicts(text: string): Map<number, { verdict: Verdict; reason: string | null }> {
  const out = new Map<number, { verdict: Verdict; reason: string | null }>()

  const match = /\[[\s\S]*\]/.exec(text)
  if (!match) return out

  let parsed: unknown
  try {
    parsed = JSON.parse(match[0])
  } catch {
    return out
  }
  if (!Array.isArray(parsed)) return out

  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as { n?: unknown; verdict?: unknown; reason?: unknown }
    const n = Number(record.n)
    const verdict = String(record.verdict)
    if (!Number.isInteger(n)) continue
    if (verdict !== 'supported' && verdict !== 'partial' && verdict !== 'unsupported') continue

    out.set(n, {
      verdict,
      reason: typeof record.reason === 'string' ? record.reason.slice(0, 200) : null,
    })
  }

  return out
}

/**
 * Partial support counts as half. A claim whose numbers were not in the source
 * is not a pass, but it is not the same failure as one the passage contradicts
 * or never mentions.
 *
 * Unchecked pairs are excluded from the denominator: they say nothing about
 * grounding either way, and counting them would make a provider outage look
 * like a quality problem.
 */
function scoreOf(checks: CitationCheck[]): number | null {
  const judged = checks.filter((c) => c.verdict !== 'unchecked')
  if (judged.length === 0) return null

  const points = judged.reduce((sum, c) => {
    if (c.verdict === 'supported') return sum + 1
    if (c.verdict === 'partial') return sum + 0.5
    return sum
  }, 0)

  return Math.round((points / judged.length) * 100)
}
