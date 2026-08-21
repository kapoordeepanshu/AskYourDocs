import { blocksFromMarkdown, titleFromMarkdown } from '../normalize'
import { ExtractionError, type ExtractedDoc } from '../types'
import { extractDocx } from './docx'
import { extractHtml } from './html'
import { extractPdf } from './pdf'

export type DetectedFormat = 'pdf' | 'docx' | 'html' | 'markdown' | 'text'

const BY_MIME: Record<string, DetectedFormat> = {
  'application/pdf': 'pdf',
  'application/x-pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/html': 'html',
  'application/xhtml+xml': 'html',
  'text/markdown': 'markdown',
  'text/x-markdown': 'markdown',
  'text/plain': 'text',
}

const BY_EXTENSION: Record<string, DetectedFormat> = {
  pdf: 'pdf',
  docx: 'docx',
  html: 'html',
  htm: 'html',
  xhtml: 'html',
  md: 'markdown',
  markdown: 'markdown',
  txt: 'text',
  text: 'text',
}

export const ACCEPTED_EXTENSIONS = Object.keys(BY_EXTENSION).map((e) => `.${e}`)

/**
 * Content sniffing wins over the declared type. Browsers send
 * application/octet-stream often enough, and a mislabelled file that we can
 * actually read should not be rejected on a header alone.
 */
export function detectFormat(input: {
  buffer: Buffer
  filename?: string
  mimeType?: string
}): DetectedFormat {
  const { buffer, filename, mimeType } = input

  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf'
  // DOCX is a zip; the extension disambiguates it from other zip payloads.
  const isZip = buffer[0] === 0x50 && buffer[1] === 0x4b
  if (isZip && filename?.toLowerCase().endsWith('.docx')) return 'docx'

  const normalisedMime = mimeType?.split(';')[0].trim().toLowerCase()
  if (normalisedMime && BY_MIME[normalisedMime]) return BY_MIME[normalisedMime]

  const extension = filename?.toLowerCase().split('.').pop()
  if (extension && BY_EXTENSION[extension]) return BY_EXTENSION[extension]

  if (isZip) {
    throw new ExtractionError(
      'That looks like a zip archive. Upload the documents inside it individually.',
    )
  }

  // Last resort: if it parses as text and smells like markup, treat it as HTML.
  const head = buffer.subarray(0, 1024).toString('utf8')
  if (/<!doctype html|<html[\s>]/i.test(head)) return 'html'

  throw new ExtractionError(
    'Unsupported file type. Supported formats: PDF, DOCX, HTML, Markdown, and plain text.',
  )
}

function extractPlainText(buffer: Buffer, fallbackTitle: string, asMarkdown: boolean): ExtractedDoc {
  const text = buffer.toString('utf8')
  if (!text.trim()) throw new ExtractionError('That file is empty.')

  return {
    // Plain text gets the same heading-aware treatment: a .txt file with
    // Markdown-style headings is common enough to be worth handling.
    title: (asMarkdown ? titleFromMarkdown(text) : undefined) || fallbackTitle,
    blocks: blocksFromMarkdown(text),
  }
}

export async function extract(input: {
  buffer: Buffer
  filename?: string
  mimeType?: string
  /** Present for URL imports; lets Readability resolve relative links. */
  url?: string
}): Promise<{ doc: ExtractedDoc; format: DetectedFormat }> {
  const format = detectFormat(input)
  const fallbackTitle = input.filename?.replace(/\.[^.]+$/, '') || input.url || 'Untitled document'

  switch (format) {
    case 'pdf':
      return { doc: await extractPdf(input.buffer, fallbackTitle), format }
    case 'docx':
      return { doc: await extractDocx(input.buffer, fallbackTitle), format }
    case 'html':
      return {
        doc: extractHtml(input.buffer.toString('utf8'), { url: input.url, fallbackTitle }),
        format,
      }
    case 'markdown':
      return { doc: extractPlainText(input.buffer, fallbackTitle, true), format }
    case 'text':
      return { doc: extractPlainText(input.buffer, fallbackTitle, false), format }
  }
}
