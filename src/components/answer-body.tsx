'use client'

import { Fragment, useMemo } from 'react'

import { parseSentences, type AnswerSentence } from '@/lib/rag/citations'
import type { Verdict } from '@/lib/rag/verify'

export interface SourceRef {
  n: number
  chunkId: string
  documentId: string
  title: string
  location: string | null
  sourceUrl: string | null
  excerpt: string
}

export interface SentenceVerdict {
  sentenceIndex: number
  verdict: Verdict
  reason: string | null
}

const VERDICT_RANK: Record<Verdict, number> = {
  unsupported: 3,
  partial: 2,
  unchecked: 1,
  supported: 0,
}

/**
 * Renders an answer with its verification result made visible.
 *
 * The point of the whole pipeline lands here: a reader who sees [3] assumes
 * someone checked passage 3. If a claim failed that check, saying so has to be
 * more prominent than the citation itself, or the marker keeps doing the
 * damage it was supposed to prevent.
 */
export function AnswerBody({
  content,
  sources,
  verdicts,
  streaming = false,
  onCitationClick,
}: {
  content: string
  sources: SourceRef[]
  verdicts: SentenceVerdict[]
  streaming?: boolean
  onCitationClick?: (n: number) => void
}) {
  const sentences = useMemo(() => parseSentences(content), [content])

  const worst = useMemo(() => {
    const map = new Map<number, SentenceVerdict>()
    for (const entry of verdicts) {
      const existing = map.get(entry.sentenceIndex)
      if (!existing || VERDICT_RANK[entry.verdict] > VERDICT_RANK[existing.verdict]) {
        map.set(entry.sentenceIndex, entry)
      }
    }
    return map
  }, [verdicts])

  // Group runs of prose into paragraphs, keeping headings and code fences
  // as their own blocks.
  const blocks = useMemo(() => groupIntoBlocks(sentences), [sentences])

  return (
    <div className="prose-answer text-[15px]">
      {blocks.map((block, index) => {
        if (block.kind === 'heading') {
          return (
            <p key={index} className="font-semibold">
              {block.text.replace(/^#{1,6}\s+/, '')}
            </p>
          )
        }

        if (block.kind === 'code') {
          return (
            <pre key={index}>
              <code>{block.text}</code>
            </pre>
          )
        }

        if (block.kind === 'list') {
          return (
            <ul key={index}>
              {block.items.map((item) => (
                <li key={item.index}>
                  <Sentence
                    sentence={item}
                    verdict={worst.get(item.index)}
                    streaming={streaming}
                    onCitationClick={onCitationClick}
                    sources={sources}
                    stripMarker
                  />
                </li>
              ))}
            </ul>
          )
        }

        return (
          <p key={index}>
            {block.items.map((item, i) => (
              <Fragment key={item.index}>
                {i > 0 && ' '}
                <Sentence
                  sentence={item}
                  verdict={worst.get(item.index)}
                  streaming={streaming}
                  onCitationClick={onCitationClick}
                  sources={sources}
                />
              </Fragment>
            ))}
          </p>
        )
      })}

      {streaming && <span className="animate-thinking ml-0.5">▍</span>}
    </div>
  )
}

function Sentence({
  sentence,
  verdict,
  streaming,
  sources,
  onCitationClick,
  stripMarker = false,
}: {
  sentence: AnswerSentence
  verdict?: SentenceVerdict
  streaming: boolean
  sources: SourceRef[]
  onCitationClick?: (n: number) => void
  stripMarker?: boolean
}) {
  const text = stripMarker ? sentence.text.replace(/^([-*+]|\d+[.)])\s+/, '') : sentence.text

  // While the answer is still arriving nothing has been verified yet, so no
  // styling is applied. Marking sentences as unsupported mid-stream would be
  // wrong and alarming.
  const state = streaming ? undefined : verdict?.verdict

  const className =
    state === 'unsupported'
      ? 'decoration-danger decoration-wavy underline underline-offset-4'
      : state === 'partial'
        ? 'decoration-warning decoration-dotted underline underline-offset-4'
        : undefined

  const title =
    state === 'unsupported'
      ? `Not supported by the cited passage${verdict?.reason ? `: ${verdict.reason}` : ''}`
      : state === 'partial'
        ? `Partly supported${verdict?.reason ? `: ${verdict.reason}` : ''}`
        : undefined

  return (
    <span className={className} title={title}>
      {renderInline(text, sources, onCitationClick)}
      {state === 'unsupported' && (
        <span
          className="ml-1 align-super text-[10px] font-semibold text-danger"
          aria-label="Not supported by the cited source"
        >
          unverified
        </span>
      )}
    </span>
  )
}

/** Splits on citation markers and inline code, leaving everything else alone. */
function renderInline(
  text: string,
  sources: SourceRef[],
  onCitationClick?: (n: number) => void,
): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  const pattern = /\[(\d{1,2})\]|`([^`]+)`|\*\*([^*]+)\*\*/g

  let last = 0
  let match: RegExpExecArray | null
  let key = 0

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index))

    if (match[1] !== undefined) {
      const n = Number(match[1])
      const source = sources.find((s) => s.n === n)
      nodes.push(
        <button
          key={`c${key++}`}
          type="button"
          onClick={() => onCitationClick?.(n)}
          title={source ? `${source.title}${source.location ? ` — ${source.location}` : ''}` : undefined}
          className="mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded bg-accent-soft px-1 align-super text-[10px] font-semibold text-accent hover:opacity-80"
        >
          {n}
        </button>,
      )
    } else if (match[2] !== undefined) {
      nodes.push(<code key={`k${key++}`}>{match[2]}</code>)
    } else if (match[3] !== undefined) {
      nodes.push(<strong key={`b${key++}`}>{match[3]}</strong>)
    }

    last = pattern.lastIndex
  }

  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

/** One member per kind so the discriminant narrows on the render side. */
type Block =
  | { kind: 'paragraph'; items: AnswerSentence[] }
  | { kind: 'list'; items: AnswerSentence[] }
  | { kind: 'heading'; text: string }
  | { kind: 'code'; text: string }

function groupIntoBlocks(sentences: AnswerSentence[]): Block[] {
  const blocks: Block[] = []
  let current: AnswerSentence[] = []
  let currentKind: 'paragraph' | 'list' = 'paragraph'
  let fence: string[] | null = null

  const flush = () => {
    if (current.length > 0) blocks.push({ kind: currentKind, items: current })
    current = []
    currentKind = 'paragraph'
  }

  for (const sentence of sentences) {
    const line = sentence.text.trim()

    if (line.startsWith('```')) {
      if (fence) {
        blocks.push({ kind: 'code', text: fence.join('\n') })
        fence = null
      } else {
        flush()
        fence = []
      }
      continue
    }

    if (fence) {
      fence.push(sentence.text)
      continue
    }

    if (sentence.structural) {
      if (/^#{1,6}\s/.test(line)) {
        flush()
        blocks.push({ kind: 'heading', text: line })
      } else if (line === '') {
        flush()
      }
      continue
    }

    const isListItem = /^([-*+]|\d+[.)])\s/.test(line)
    const kind = isListItem ? 'list' : 'paragraph'
    if (kind !== currentKind) flush()
    currentKind = kind
    current.push(sentence)
  }

  if (fence) blocks.push({ kind: 'code', text: fence.join('\n') })
  flush()

  return blocks
}
