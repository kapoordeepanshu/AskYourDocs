import { Readability } from '@mozilla/readability'
import { JSDOM, VirtualConsole } from 'jsdom'
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
 */
export function extractHtml(
  html: string,
  options: { url?: string; fallbackTitle?: string } = {},
): ExtractedDoc {
  // A page that scripts or logs during parse should not be able to spam the
  // worker's output or execute anything.
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('error', () => {})
  virtualConsole.on('jsdomError', () => {})

  let dom: JSDOM
  try {
    dom = new JSDOM(html, {
      ...(options.url ? { url: options.url } : {}),
      virtualConsole,
      // Scripts are never executed. This is load-bearing for security, not a
      // performance choice.
      runScripts: undefined,
    })
  } catch (error) {
    throw new ExtractionError(
      `Could not parse that HTML: ${error instanceof Error ? error.message : 'unknown error'}`,
    )
  }

  const documentTitle = dom.window.document.title?.trim()

  // Readability mutates the document it is given, so parse a clone and keep the
  // original available as a fallback.
  let articleHtml: string | undefined
  let articleTitle: string | undefined
  try {
    const clone = dom.window.document.cloneNode(true) as Document
    const article = new Readability(clone).parse()
    if (article?.content && article.textContent.trim().length >= READABILITY_MIN_CHARS) {
      articleHtml = article.content
      articleTitle = article.title?.trim()
    }
  } catch {
    // Readability throws on some malformed documents; the raw body still works.
  }

  let sourceHtml = articleHtml
  if (!sourceHtml) {
    const body = dom.window.document.body
    if (!body) throw new ExtractionError('That HTML document has no body.')
    for (const selector of CHROME_SELECTORS) {
      body.querySelectorAll(selector).forEach((node) => node.remove())
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
    articleTitle || documentTitle || titleFromMarkdown(markdown) || options.fallbackTitle || 'Untitled page'

  return { title, blocks: blocksFromMarkdown(markdown) }
}
