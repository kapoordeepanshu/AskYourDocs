import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'
import TurndownService from 'turndown'

import { blocksFromMarkdown, titleFromMarkdown } from '../normalize'
import { ExtractionError, type ExtractedDoc } from '../types'

/** Below this, Readability probably stripped real content, so use the raw body. */
const READABILITY_MIN_CHARS = 200

/** Removed before conversion: never the answer, always noise in retrieval. */
const CHROME_SELECTORS = [
  'script',
  'style',
  'noscript',
  'template',
  'iframe',
  'svg',
  'nav',
  'header',
  'footer',
  'aside',
  'form',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
  '[aria-hidden="true"]',
  '.sidebar',
  '.nav',
  '.navbar',
  '.menu',
  '.breadcrumb',
  '.cookie',
  '.advert',
  '.advertisement',
]

function turndown(): TurndownService {
  const service = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    hr: '---',
  })

  // Tables carry a lot of the useful content in product and policy documents,
  // and Turndown drops them by default.
  service.addRule('tableCell', {
    filter: ['th', 'td'],
    replacement: (content) => ` ${content.replace(/\n+/g, ' ').trim()} |`,
  })
  service.addRule('tableRow', {
    filter: 'tr',
    replacement: (content) => `|${content}\n`,
  })
  service.addRule('stripImages', {
    filter: 'img',
    // An image with no text layer contributes nothing retrievable, and its alt
    // text is usually decorative.
    replacement: () => '',
  })

  return service
}

/**
 * HTML from an upload or a fetched page.
 *
 * Readability strips navigation, related-article rails, and comment threads.
 * That matters more than it sounds: boilerplate repeated across every page of
 * a documentation site is the single biggest source of near-duplicate chunks,
 * and near-duplicates crowd out the real answer in retrieval.
 *
 * Parsed with linkedom rather than jsdom. linkedom never executes scripts at
 * all, which is the property that matters when the input is a page a user
 * asked us to fetch, and it avoids jsdom's optional `canvas` peer dependency,
 * which drags a native build toolchain into the image for a feature this app
 * has no use for.
 */
export function extractHtml(
  html: string,
  options: { url?: string; fallbackTitle?: string } = {},
): ExtractedDoc {
  let documentTitle: string | undefined
  let articleHtml: string | undefined
  let articleTitle: string | undefined

  try {
    // Readability mutates the document it is given, so it gets its own parse
    // and the fallback path re-parses from the original source.
    const { document } = parseHTML(html)
    documentTitle = document.title?.trim()

    const article = new Readability(document as unknown as Document).parse()
    if (article?.content && (article.textContent ?? '').trim().length >= READABILITY_MIN_CHARS) {
      articleHtml = article.content
      articleTitle = article.title?.trim()
    }
  } catch {
    // Readability throws on some malformed documents; the raw body still works.
  }

  let sourceHtml = articleHtml
  if (!sourceHtml) {
    const { document } = parseHTML(html)
    const body = document.body
    if (!body) throw new ExtractionError('That HTML document has no body.')

    for (const selector of CHROME_SELECTORS) {
      for (const node of body.querySelectorAll(selector)) node.remove()
    }
    sourceHtml = body.innerHTML
  }

  const markdown = turndown().turndown(sourceHtml).trim()
  if (!markdown) {
    throw new ExtractionError(
      'No readable text was found. If the page renders its content with JavaScript, save it as a PDF and upload that instead.',
    )
  }

  const title =
    articleTitle ||
    documentTitle ||
    titleFromMarkdown(markdown) ||
    options.fallbackTitle ||
    'Untitled page'

  return { title, blocks: blocksFromMarkdown(markdown) }
}
