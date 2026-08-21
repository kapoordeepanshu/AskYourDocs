import { describe, expect, it } from 'vitest'

import { detectFormat } from '@/lib/ingest/adapters'
import { extractHtml } from '@/lib/ingest/adapters/html'
import { assemble } from '@/lib/ingest/normalize'
import { ExtractionError } from '@/lib/ingest/types'

const ARTICLE = `<!doctype html>
<html>
  <head><title>Refund Policy — Acme</title></head>
  <body>
    <nav><a href="/">Home</a><a href="/pricing">Pricing</a></nav>
    <header>Acme Corporation</header>
    <article>
      <h1>Refund Policy</h1>
      <p>Customers may request a refund within 30 days of purchase. Requests made after
         that window are declined automatically by the billing system.</p>
      <h2>Exceptions</h2>
      <p>Annual plans purchased under a negotiated contract follow the terms of that
         contract instead of this policy, including any longer refund window.</p>
      <ul><li>Enterprise agreements</li><li>Educational licences</li></ul>
      <table><tr><th>Plan</th><th>Window</th></tr><tr><td>Monthly</td><td>30 days</td></tr></table>
    </article>
    <footer>Copyright Acme</footer>
    <script>window.analytics.track('view')</script>
  </body>
</html>`

describe('extractHtml', () => {
  it('extracts the article and drops navigation and footer chrome', () => {
    const doc = extractHtml(ARTICLE, { fallbackTitle: 'fallback' })
    const text = assemble(doc).text

    expect(text).toContain('30 days of purchase')
    expect(text).not.toContain('Pricing')
    expect(text).not.toContain('Copyright Acme')
  })

  it('never surfaces script contents as text', () => {
    const text = assemble(extractHtml(ARTICLE)).text
    expect(text).not.toContain('analytics.track')
  })

  it('prefers a real title over the fallback', () => {
    const doc = extractHtml(ARTICLE, { fallbackTitle: 'fallback' })
    expect(doc.title.toLowerCase()).toContain('refund')
  })

  it('carries headings onto the blocks beneath them', () => {
    const doc = extractHtml(ARTICLE)
    const withHeadings = doc.blocks.filter((b) => b.heading)

    expect(withHeadings.length).toBeGreaterThan(0)
    expect(doc.blocks.some((b) => b.heading === 'Exceptions')).toBe(true)
    // The anchor is what a citation deep-links to.
    expect(doc.blocks.find((b) => b.heading === 'Exceptions')?.anchor).toBe('exceptions')
  })

  it('keeps table content, which policy documents rely on', () => {
    const text = assemble(extractHtml(ARTICLE)).text
    expect(text).toContain('Monthly')
  })

  it('falls back to the body when there is no article to find', () => {
    const bare = '<html><body><div>Just a short sentence about cats.</div></body></html>'
    const text = assemble(extractHtml(bare, { fallbackTitle: 'notes' })).text
    expect(text).toContain('cats')
  })

  it('rejects markup with no readable text', () => {
    expect(() => extractHtml('<html><body><script>x=1</script></body></html>')).toThrow(
      ExtractionError,
    )
  })
})

describe('detectFormat', () => {
  it('detects a PDF from its magic bytes regardless of the declared type', () => {
    const buffer = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(32)])
    expect(detectFormat({ buffer, filename: 'mislabelled.txt', mimeType: 'text/plain' })).toBe('pdf')
  })

  it('detects DOCX from the zip header plus the extension', () => {
    const buffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(16)])
    expect(detectFormat({ buffer, filename: 'report.docx' })).toBe('docx')
  })

  it('rejects a plain zip with a clear message', () => {
    const buffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(16)])
    expect(() => detectFormat({ buffer, filename: 'bundle.zip' })).toThrow(/zip archive/i)
  })

  it('sniffs HTML when the extension and type are both unhelpful', () => {
    const buffer = Buffer.from('<!DOCTYPE html><html><body>hi</body></html>')
    expect(detectFormat({ buffer, filename: 'download', mimeType: 'application/octet-stream' })).toBe(
      'html',
    )
  })

  it('rejects an unsupported binary', () => {
    const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])
    expect(() => detectFormat({ buffer, filename: 'photo.png' })).toThrow(/Unsupported file type/i)
  })
})
