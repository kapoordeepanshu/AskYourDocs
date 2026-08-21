import { ExtractionError, type ExtractedDoc } from '../types'
import { extractHtml } from './html'

/**
 * DOCX goes through HTML rather than mammoth's raw-text extractor, because the
 * HTML path preserves heading levels, lists, and tables. Those headings become
 * chunk locators, so a citation can say which section a claim came from.
 */
export async function extractDocx(buffer: Buffer, fallbackTitle: string): Promise<ExtractedDoc> {
  const mammoth = await import('mammoth')

  let html: string
  try {
    const result = await mammoth.convertToHtml(
      { buffer },
      {
        // Word's default styles do not map to headings on their own; this makes
        // "Title" and "Subtitle" behave like the outline the author intended.
        styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh"],
      },
    )
    html = result.value
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error'
    if (/end of central directory|zip/i.test(message)) {
      throw new ExtractionError(
        'That file is not a valid .docx. Older .doc files are not supported; re-save it as .docx.',
      )
    }
    throw new ExtractionError(`Could not read that document: ${message}`)
  }

  if (!html.trim()) {
    throw new ExtractionError('That document appears to be empty.')
  }

  return extractHtml(html, { fallbackTitle })
}
