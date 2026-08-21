import { describe, expect, it } from 'vitest'

import {
  citedSentences,
  extractPassageNumbers,
  parseSentences,
  stripCitations,
  uncitedSentences,
} from '@/lib/rag/citations'

describe('extractPassageNumbers', () => {
  it('pulls markers in order without duplicates', () => {
    expect(extractPassageNumbers('Claim [2] and again [2] plus [7].')).toEqual([2, 7])
  })

  it('ignores brackets that are not citations', () => {
    expect(extractPassageNumbers('An array like [foo] or [].')).toEqual([])
  })
})

describe('stripCitations', () => {
  it('removes markers and tidies the spacing left behind', () => {
    expect(stripCitations('The limit is 30 days [3].')).toBe('The limit is 30 days.')
  })
})

describe('parseSentences', () => {
  it('splits prose into sentences and attaches their citations', () => {
    const sentences = parseSentences('The cap is 30 days [1]. Extensions need approval [2].')
    const cited = citedSentences(sentences)

    expect(cited).toHaveLength(2)
    expect(cited[0].passages).toEqual([1])
    expect(cited[1].passages).toEqual([2])
  })

  it('treats a list item as one claim even with internal full stops', () => {
    const sentences = parseSentences('- Submit the form. Then wait for approval [4]')
    const cited = citedSentences(sentences)

    // Splitting here would strand "Submit the form" without its citation.
    expect(cited).toHaveLength(1)
    expect(cited[0].passages).toEqual([4])
  })

  it('marks headings and fenced code as structural, not claims', () => {
    const sentences = parseSentences('## Overview\n\n```\ncode here\n```\n\nA real claim [1].')

    expect(citedSentences(sentences)).toHaveLength(1)
    expect(sentences.some((s) => s.structural && s.text.includes('Overview'))).toBe(true)
  })

  it('reports assertions that carry no citation at all', () => {
    const sentences = parseSentences('Supported claim [1]. An unsupported aside with no source.')
    expect(uncitedSentences(sentences)).toHaveLength(1)
  })

  it('does not split on an abbreviation inside a sentence', () => {
    const sentences = parseSentences('See Fig. 4 for the breakdown [2].')
    expect(citedSentences(sentences)).toHaveLength(1)
  })

  it('handles a refusal, which carries no citations by design', () => {
    const sentences = parseSentences('I could not find anything in your documents about that.')
    expect(citedSentences(sentences)).toHaveLength(0)
    expect(uncitedSentences(sentences)).toHaveLength(1)
  })
})
