import { ExtractionError, type ExtractedDoc, type SourceBlock } from '../types'

/**
 * PDF text extraction, page by page.
 *
 * Pages are kept separate rather than merged so every chunk can cite a real
 * page number. That is the difference between "this is in your handbook" and
 * "this is on page 47", and it is the whole point of storing a locator.
 */
export async function extractPdf(buffer: Buffer, fallbackTitle: string): Promise<ExtractedDoc> {
  // Imported lazily: unpdf pulls in a large PDF.js bundle that a DOCX-only
  // instance should never pay for.
  const { extractText, getDocumentProxy } = await import('unpdf')

  let pages: string[]
  let totalPages: number
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>

  try {
    pdf = await getDocumentProxy(new Uint8Array(buffer))
    const result = await extractText(pdf, { mergePages: false })
    totalPages = result.totalPages
    pages = Array.isArray(result.text) ? result.text : [String(result.text)]
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error'
    if (/password/i.test(message)) {
      throw new ExtractionError('That PDF is password protected. Remove the password and try again.')
    }
    throw new ExtractionError(`Could not read that PDF: ${message}`)
  }

  const blocks: SourceBlock[] = []
  for (const [index, text] of pages.entries()) {
    const trimmed = text?.trim()
    if (trimmed) blocks.push({ text: trimmed, page: index + 1 })
  }

  if (blocks.length === 0) {
    throw new ExtractionError(
      'No text layer was found in that PDF. It is most likely a scan; OCR is not supported yet.',
    )
  }

  return {
    title: (await pdfTitle(pdf)) || fallbackTitle,
    blocks,
    pageCount: totalPages,
  }
}

/** Document metadata is often blank or junk, so the filename stays the fallback. */
async function pdfTitle(pdf: { getMetadata: () => Promise<unknown> }): Promise<string | undefined> {
  try {
    const meta = (await pdf.getMetadata()) as { info?: { Title?: string } }
    const title = meta?.info?.Title?.trim()
    // Producers frequently write the source path or a template name here.
    if (!title || title.length < 3 || /\.(indd|docx?|pdf|pages)$/i.test(title)) return undefined
    return title
  } catch {
    return undefined
  }
}
