import type { ExtractedDoc, NormalizedDoc, PositionedBlock, SourceBlock } from './types'

const BLOCK_SEPARATOR = '\n\n'

/**
 * Collapses the whitespace PDF and HTML extraction leaves behind, without
 * destroying paragraph structure. Chunk boundaries and citation offsets are
 * both computed against this text, so it has to be stable.
 */
export function cleanText(input: string): string {
  return (
    input
      // Normalise line endings first so later rules only handle \n.
      .replace(/\r\n?/g, '\n')
      // Soft hyphens and zero-width characters survive PDF extraction and
      // break both search and embedding quality. Written as escapes because
      // the literal characters are invisible in a diff.
      .replace(/[\u00AD\u200B-\u200D\uFEFF]/g, '')
      // A hyphen at end of line is nearly always a word split across lines.
      .replace(/(\w)-\n(\w)/g, '$1$2')
      .replace(/[ \t]+/g, ' ')
      .replace(/ ?\n ?/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .slice(0, 80)
}

/**
 * Joins blocks into one document string and records where each one landed.
 * Those offsets are what let a citation point back at an exact span rather
 * than just naming the file.
 */
export function assemble(extracted: ExtractedDoc): NormalizedDoc {
  const blocks: PositionedBlock[] = []
  const parts: string[] = []
  let cursor = 0

  for (const block of extracted.blocks) {
    const text = cleanText(block.text)
    if (!text) continue

    if (parts.length > 0) cursor += BLOCK_SEPARATOR.length

    blocks.push({ ...block, text, charStart: cursor, charEnd: cursor + text.length })
    parts.push(text)
    cursor += text.length
  }

  return {
    title: extracted.title.trim() || 'Untitled document',
    text: parts.join(BLOCK_SEPARATOR),
    blocks,
    pageCount: extracted.pageCount,
  }
}

/**
 * Splits Markdown (or plain text) into blocks, carrying the nearest heading
 * down onto everything beneath it.
 */
export function blocksFromMarkdown(markdown: string): SourceBlock[] {
  const blocks: SourceBlock[] = []
  let heading: string | undefined
  let anchor: string | undefined
  let buffer: string[] = []

  const flush = () => {
    const text = buffer.join('\n').trim()
    if (text) blocks.push({ text, heading, anchor })
    buffer = []
  }

  for (const line of markdown.split('\n')) {
    const match = /^(#{1,6})\s+(.*)$/.exec(line)
    if (match) {
      flush()
      heading = match[2].replace(/#+\s*$/, '').trim()
      anchor = slugify(heading)
      // Keep the heading in the body: it is often the most retrievable phrase
      // in the section, and dropping it hurts recall on "how do I X" queries.
      buffer.push(line)
      continue
    }

    if (line.trim() === '') {
      flush()
      continue
    }

    buffer.push(line)
  }

  flush()
  return blocks
}

/** First Markdown heading, used when a source carries no real title. */
export function titleFromMarkdown(markdown: string): string | undefined {
  const match = /^#{1,6}\s+(.+)$/m.exec(markdown)
  return match?.[1].trim()
}
