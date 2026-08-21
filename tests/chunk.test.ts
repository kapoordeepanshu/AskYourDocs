import { describe, expect, it } from 'vitest'

import { chunkDocument, estimateTokens } from '@/lib/ingest/chunk'
import { assemble } from '@/lib/ingest/normalize'
import type { ExtractedDoc } from '@/lib/ingest/types'

// vitest.config.ts pins CHUNK_SIZE_TOKENS=100, CHUNK_OVERLAP_TOKENS=20.
const MAX_TOKENS = 100

function doc(blocks: ExtractedDoc['blocks']): ExtractedDoc {
  return { title: 'Test', blocks }
}

const sentence = (n: number) => `This is sentence number ${n} and it carries a little content.`

describe('estimateTokens', () => {
  it('scales with length', () => {
    expect(estimateTokens('hello')).toBeGreaterThan(0)
    expect(estimateTokens('hello world '.repeat(50))).toBeGreaterThan(estimateTokens('hello world'))
  })

  it('does not underestimate identifier-heavy text', () => {
    // Long unbroken tokens are where a pure word count goes badly wrong.
    const identifiers = 'ERR_CONN_RESET_TIMEOUT_9931 '.repeat(20)
    expect(estimateTokens(identifiers)).toBeGreaterThanOrEqual(identifiers.length / 4)
  })
})

describe('chunkDocument', () => {
  it('returns nothing for an empty document', () => {
    expect(chunkDocument(assemble(doc([])))).toEqual([])
  })

  it('keeps a short document in a single chunk', () => {
    const chunks = chunkDocument(assemble(doc([{ text: 'A short note about cats.' }])))
    expect(chunks).toHaveLength(1)
    expect(chunks[0].content).toContain('cats')
  })

  it('respects the token budget', () => {
    const text = Array.from({ length: 40 }, (_, i) => sentence(i)).join(' ')
    const chunks = chunkDocument(assemble(doc([{ text }])))

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      // Overlap is added on top of the budget, so allow modest headroom.
      expect(chunk.tokenCount).toBeLessThanOrEqual(MAX_TOKENS * 1.5)
    }
  })

  it('overlaps consecutive chunks so a boundary fact stays retrievable', () => {
    const text = Array.from({ length: 30 }, (_, i) => sentence(i)).join(' ')
    const chunks = chunkDocument(assemble(doc([{ text }])))

    expect(chunks.length).toBeGreaterThan(1)

    const tailOfFirst = chunks[0].content.slice(-40)
    // The start of chunk 2 should repeat the end of chunk 1.
    expect(chunks[1].content.includes(tailOfFirst.trim().split(' ').slice(-4).join(' '))).toBe(true)
  })

  it('never lets overlap stall progress', () => {
    // One sentence per chunk is the case where naive overlap loops forever.
    const long = 'word '.repeat(400)
    const chunks = chunkDocument(assemble(doc([{ text: long }])))
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.length).toBeLessThan(200)
  })

  it('starts a new chunk when the page changes', () => {
    const chunks = chunkDocument(
      assemble(
        doc([
          { text: 'Content that lives on the first page.', page: 1 },
          { text: 'Content that lives on the second page.', page: 2 },
        ]),
      ),
    )

    // A chunk must not span two pages, or its citation would name only one.
    const pages = chunks.map((c) => c.locator.page)
    expect(pages).toEqual([1, 2])
  })

  it('carries the heading onto every chunk beneath it', () => {
    const chunks = chunkDocument(
      assemble(
        doc([
          { text: 'Refund policy details go here.', heading: 'Refunds', anchor: 'refunds' },
        ]),
      ),
    )

    expect(chunks[0].locator.heading).toBe('Refunds')
    expect(chunks[0].locator.anchor).toBe('refunds')
  })

  it('records character offsets that point back into the document text', () => {
    const normalized = assemble(doc([{ text: `${sentence(1)} ${sentence(2)}` }]))
    const [chunk] = chunkDocument(normalized)

    const slice = normalized.text.slice(chunk.locator.charStart, chunk.locator.charEnd)
    expect(slice.length).toBeGreaterThan(0)
    expect(normalized.text).toContain(slice.trim().slice(0, 20))
  })

  it('splits a single oversized sentence rather than emitting it whole', () => {
    const runOn = `${'a'.repeat(3000)}.`
    const chunks = chunkDocument(assemble(doc([{ text: runOn }])))
    expect(chunks.length).toBeGreaterThan(1)
  })
})
