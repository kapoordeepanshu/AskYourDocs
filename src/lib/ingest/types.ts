/**
 * Every source format collapses to this before the rest of the pipeline sees
 * it. Adding a format later means writing one adapter, not touching chunking,
 * embedding, retrieval, or the interface.
 */

export interface SourceBlock {
  text: string
  /** PDF and DOCX. 1-based, matching what a reader sees. */
  page?: number
  /** HTML, Markdown, and URL sources: the nearest preceding heading. */
  heading?: string
  /** Slugified heading, so a citation can deep-link with #anchor. */
  anchor?: string
}

export interface ExtractedDoc {
  /** Best available title: PDF metadata, first heading, or the filename. */
  title: string
  blocks: SourceBlock[]
  pageCount?: number
}

export interface PositionedBlock extends SourceBlock {
  charStart: number
  charEnd: number
}

export interface NormalizedDoc {
  title: string
  /** Blocks joined with blank lines. What the chunker slices. */
  text: string
  blocks: PositionedBlock[]
  pageCount?: number
}

export class ExtractionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExtractionError'
  }
}
