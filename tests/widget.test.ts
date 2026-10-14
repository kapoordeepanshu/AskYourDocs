import { describe, expect, it } from 'vitest'

import { parseSentences } from '@/lib/rag/citations'
import type { CitationCheck } from '@/lib/rag/verify'
import { isOriginAllowed, matchOrigin, normalizeOriginPattern } from '@/lib/widget/origins'
import { buildSegments } from '@/lib/widget/segments'

const APP = 'https://docs.example.org'

describe('normalizeOriginPattern', () => {
  it('accepts what people paste from the address bar', () => {
    expect(normalizeOriginPattern('Example.com')).toBe('https://example.com')
    expect(normalizeOriginPattern('https://www.example.com/rooms?x=1')).toBe(
      'https://www.example.com',
    )
    expect(normalizeOriginPattern('http://localhost:8080/')).toBe('http://localhost:8080')
  })

  it('keeps a subdomain wildcard', () => {
    expect(normalizeOriginPattern('*.example.com')).toBe('https://*.example.com')
  })

  it('rejects things that are not websites', () => {
    expect(normalizeOriginPattern('')).toBeNull()
    expect(normalizeOriginPattern('not a url')).toBeNull()
    expect(normalizeOriginPattern('ftp://example.com')).toBeNull()
    expect(normalizeOriginPattern('intranet')).toBeNull()
  })
})

describe('matchOrigin', () => {
  it('matches exact origins only', () => {
    expect(matchOrigin('https://example.com', 'https://example.com')).toBe(true)
    expect(matchOrigin('https://example.com', 'http://example.com')).toBe(false)
    expect(matchOrigin('https://example.com', 'https://example.com:8443')).toBe(false)
  })

  it('matches subdomains for a wildcard, but not the bare domain or lookalikes', () => {
    const pattern = 'https://*.example.com'
    expect(matchOrigin(pattern, 'https://shop.example.com')).toBe(true)
    expect(matchOrigin(pattern, 'https://a.b.example.com')).toBe(true)
    expect(matchOrigin(pattern, 'https://example.com')).toBe(false)
    expect(matchOrigin(pattern, 'https://evil-example.com')).toBe(false)
    expect(matchOrigin(pattern, 'https://example.com.evil.net')).toBe(false)
    expect(matchOrigin(pattern, 'http://shop.example.com')).toBe(false)
  })
})

describe('isOriginAllowed', () => {
  it('allows any origin when the list is empty', () => {
    expect(isOriginAllowed([], 'https://anything.test', APP)).toBe(true)
    expect(isOriginAllowed([], null, APP)).toBe(true)
  })

  it('always allows the app itself, for the preview page', () => {
    expect(isOriginAllowed(['https://hotel.example'], APP, APP)).toBe(true)
  })

  it('enforces the list, and refuses a missing Origin once a list is set', () => {
    const allowed = ['https://hotel.example']
    expect(isOriginAllowed(allowed, 'https://hotel.example', APP)).toBe(true)
    expect(isOriginAllowed(allowed, 'https://other.example', APP)).toBe(false)
    expect(isOriginAllowed(allowed, null, APP)).toBe(false)
  })
})

function check(sentenceIndex: number, verdict: CitationCheck['verdict']): CitationCheck {
  return {
    sentenceIndex,
    sentence: '',
    passage: 1,
    chunkId: 'c',
    documentId: 'd',
    verdict,
    reason: null,
  }
}

describe('buildSegments', () => {
  const answer = 'Check-in is from 3pm [1]. Breakfast is free [2].\n\n- Parking costs 20 CHF [3]'

  it('removes sentences their source does not support and counts them', () => {
    const { segments, removed } = buildSegments(answer, [check(0, 'supported'), check(1, 'unsupported')])

    expect(removed).toBe(1)
    expect(segments.map((s) => s.text)).not.toContain('Breakfast is free [2].')
    expect(segments.some((s) => s.text.startsWith('Check-in'))).toBe(true)
  })

  it('takes the worst verdict when a sentence cites several passages', () => {
    const { segments } = buildSegments('Pets are welcome [1][2].', [
      check(0, 'supported'),
      check(0, 'partial'),
    ])
    expect(segments[0].verdict).toBe('partial')
  })

  it('keeps line numbers so lists and paragraphs can be rebuilt', () => {
    const { segments } = buildSegments(answer, [])
    const parking = segments.find((s) => s.text.includes('Parking'))
    expect(parking?.line).toBe(2)
  })
})

describe('parseSentences in other languages', () => {
  it('splits before an accented capital', () => {
    const sentences = parseSentences('Le check-in est à 15h [1]. Écrivez-nous pour un départ tardif [2].')
    expect(sentences.filter((s) => s.passages.length > 0)).toHaveLength(2)
  })

  it('treats a German sentence as a claim', () => {
    const [sentence] = parseSentences('Über Nacht ist die Rezeption geschlossen [1].')
    expect(sentence.structural).toBe(false)
  })
})
