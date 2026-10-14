/**
 * Splitting a generated answer into citable units.
 *
 * Verification happens per sentence, so this decides what gets checked. Two
 * things matter: a list item is its own claim even without a full stop, and a
 * heading or code fence is not a claim at all.
 */

export interface AnswerSentence {
  index: number
  text: string
  /** 1-based passage numbers cited by this sentence, in order of appearance. */
  passages: number[]
  /** True for headings, fenced code, and blank structure - not verified. */
  structural: boolean
  /** 0-based line of the answer this came from, so a renderer can rebuild the layout. */
  line: number
}

const CITATION = /\[(\d{1,2})\]/g

export function extractPassageNumbers(text: string): number[] {
  const found: number[] = []
  for (const match of text.matchAll(CITATION)) {
    const value = Number(match[1])
    if (Number.isInteger(value) && value > 0 && !found.includes(value)) found.push(value)
  }
  return found
}

/** Text as shown to the reader, with the raw markers removed. */
export function stripCitations(text: string): string {
  return text.replace(CITATION, '').replace(/\s{2,}/g, ' ').replace(/\s+([.,;:])/g, '$1').trim()
}

// Any uppercase letter, not just A-Z, so answers in German or French split too.
const SENTENCE_BOUNDARY = /(?<=[.!?])(["')\]]*)\s+(?=[\p{Lu}\p{N}"'(\[])/u

export function parseSentences(answer: string): AnswerSentence[] {
  const sentences: AnswerSentence[] = []
  let index = 0
  let inFence = false

  for (const [lineIndex, rawLine] of answer.split('\n').entries()) {
    const line = rawLine.trim()

    if (line.startsWith('```')) {
      inFence = !inFence
      sentences.push({
        index: index++,
        text: rawLine,
        passages: [],
        structural: true,
        line: lineIndex,
      })
      continue
    }

    if (inFence || line === '' || /^#{1,6}\s/.test(line) || /^[-*_]{3,}$/.test(line)) {
      sentences.push({
        index: index++,
        text: rawLine,
        passages: [],
        structural: true,
        line: lineIndex,
      })
      continue
    }

    // A list item is one claim regardless of how many sentences it contains;
    // splitting it would separate the citation from half the statement.
    const isListItem = /^([-*+]|\d+[.)])\s/.test(line)
    const parts = isListItem ? [line] : line.split(SENTENCE_BOUNDARY).filter(Boolean)

    for (const part of parts) {
      const text = part.trim()
      if (!text) continue
      sentences.push({
        index: index++,
        text,
        passages: extractPassageNumbers(text),
        // A fragment with no letters (stray punctuation from the split) is not
        // a claim worth verifying.
        structural: !/\p{L}/u.test(text),
        line: lineIndex,
      })
    }
  }

  return sentences
}

/** Sentences that assert something and name a source: the verifiable set. */
export function citedSentences(sentences: AnswerSentence[]): AnswerSentence[] {
  return sentences.filter((s) => !s.structural && s.passages.length > 0)
}

/**
 * Non-structural sentences with no citation at all. These are not verifiable,
 * and the model was told to cite everything, so they are reported rather than
 * quietly accepted.
 */
export function uncitedSentences(sentences: AnswerSentence[]): AnswerSentence[] {
  return sentences.filter((s) => !s.structural && s.passages.length === 0)
}
