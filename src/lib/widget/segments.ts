import { parseSentences } from '@/lib/rag/citations'
import type { CitationCheck, Verdict } from '@/lib/rag/verify'

/**
 * One rendered piece of a finished widget answer.
 *
 * The widget streams the raw answer while it is being written, then replaces
 * it with these once verification has run. That second render is where a
 * sentence its own source does not support gets removed, so a visitor is
 * never left reading a claim the check rejected.
 */
export interface AnswerSegment {
  /** Sentence text including its [n] markers. */
  text: string
  /** 0-based answer line, so the widget can rebuild paragraphs and lists. */
  line: number
  /** Worst verdict across this sentence's citations; null when nothing was cited. */
  verdict: Verdict | null
}

const SEVERITY: Record<Verdict, number> = {
  supported: 0,
  unchecked: 1,
  partial: 2,
  unsupported: 3,
}

export function buildSegments(
  answer: string,
  checks: CitationCheck[],
): { segments: AnswerSegment[]; removed: number } {
  const worst = new Map<number, Verdict>()
  for (const check of checks) {
    const current = worst.get(check.sentenceIndex)
    if (!current || SEVERITY[check.verdict] > SEVERITY[current]) {
      worst.set(check.sentenceIndex, check.verdict)
    }
  }

  const segments: AnswerSegment[] = []
  let removed = 0

  for (const sentence of parseSentences(answer)) {
    const verdict = worst.get(sentence.index) ?? null
    if (verdict === 'unsupported') {
      removed++
      continue
    }
    segments.push({ text: sentence.text, line: sentence.line, verdict })
  }

  return { segments, removed }
}
