import OpenAI from 'openai'

import { env } from '@/lib/env'
import {
  type ChatMessage,
  type CompletionResult,
  type EmbeddingProvider,
  type GenerateOptions,
  type LlmProvider,
  ProviderError,
} from './types'

const DEFAULT_MAX_TOKENS = 2048
/** Large batches are where embedding calls time out, so keep them predictable. */
const EMBED_BATCH_SIZE = 96

type Flavour = 'openai' | 'ollama'

/**
 * Serves both OpenAI and Ollama. Ollama exposes an OpenAI-compatible /v1
 * endpoint, so one adapter covers both and the only differences are the base
 * URL, the model name, and the fact that Ollama ignores the API key.
 */
export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name: Flavour
  readonly model: string
  private client: OpenAI

  constructor(flavour: Flavour) {
    this.name = flavour

    if (flavour === 'ollama') {
      this.client = new OpenAI({ baseURL: env().OLLAMA_BASE_URL, apiKey: 'ollama' })
      this.model = env().OLLAMA_MODEL
    } else {
      const key = env().OPENAI_API_KEY
      if (!key) throw new ProviderError('openai', 'OPENAI_API_KEY is not set')
      this.client = new OpenAI({ apiKey: key })
      this.model = env().OPENAI_MODEL
    }
  }

  async *stream(messages: ChatMessage[], options: GenerateOptions = {}) {
    try {
      const stream = await this.client.chat.completions.create(
        {
          model: this.model,
          max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
          temperature: options.temperature ?? 0,
          messages: toOpenAiMessages(messages, options.system),
          stream: true,
        },
        { signal: options.signal },
      )

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content
        if (delta) yield delta
      }
    } catch (error) {
      if (options.signal?.aborted) return
      throw new ProviderError(this.name, describe(this.name, error), error)
    }
  }

  async complete(
    messages: ChatMessage[],
    options: GenerateOptions = {},
  ): Promise<CompletionResult> {
    try {
      const response = await this.client.chat.completions.create(
        {
          model: this.model,
          max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
          temperature: options.temperature ?? 0,
          messages: toOpenAiMessages(messages, options.system),
        },
        { signal: options.signal },
      )

      return {
        text: response.choices[0]?.message?.content ?? '',
        model: response.model,
        usage: {
          promptTokens: response.usage?.prompt_tokens,
          completionTokens: response.usage?.completion_tokens,
        },
      }
    } catch (error) {
      throw new ProviderError(this.name, describe(this.name, error), error)
    }
  }
}

export class OpenAiCompatibleEmbeddings implements EmbeddingProvider {
  readonly name: Flavour
  readonly model: string
  readonly dimensions: number
  private client: OpenAI

  constructor(flavour: Flavour) {
    this.name = flavour
    this.dimensions = env().EMBEDDING_DIMENSIONS

    if (flavour === 'ollama') {
      this.client = new OpenAI({ baseURL: env().OLLAMA_BASE_URL, apiKey: 'ollama' })
      this.model = env().OLLAMA_EMBEDDING_MODEL
    } else {
      const key = env().OPENAI_API_KEY
      if (!key) throw new ProviderError('openai', 'OPENAI_API_KEY is not set')
      this.client = new OpenAI({ apiKey: key })
      this.model = env().OPENAI_EMBEDDING_MODEL
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []

    const vectors: number[][] = []
    for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
      const batch = texts.slice(i, i + EMBED_BATCH_SIZE)
      try {
        const response = await this.client.embeddings.create({
          model: this.model,
          // An empty string is a plausible chunking artefact but an invalid
          // embedding input, so send something harmless instead.
          input: batch.map((t) => (t.trim() === '' ? ' ' : t)),
        })

        // Input order preservation is documented, but a mismatch here would
        // silently attach every vector to the wrong chunk. Check it.
        const sorted = [...response.data].sort((a, b) => a.index - b.index)
        if (sorted.length !== batch.length) {
          throw new Error(`expected ${batch.length} embeddings, received ${sorted.length}`)
        }

        for (const item of sorted) {
          if (item.embedding.length !== this.dimensions) {
            throw new Error(
              `model ${this.model} returned ${item.embedding.length} dimensions but ` +
                `EMBEDDING_DIMENSIONS is ${this.dimensions}. These must match, and ` +
                `changing it requires re-indexing every document.`,
            )
          }
          vectors.push(item.embedding)
        }
      } catch (error) {
        throw new ProviderError(this.name, describe(this.name, error), error)
      }
    }

    return vectors
  }
}

function toOpenAiMessages(
  messages: ChatMessage[],
  system?: string,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.ChatCompletionMessageParam[] = []
  if (system) out.push({ role: 'system', content: system })
  for (const m of messages) out.push({ role: m.role, content: m.content })
  return out
}

function describe(flavour: Flavour, error: unknown): string {
  if (error instanceof OpenAI.APIError) {
    if (error.status === 401) {
      return flavour === 'ollama'
        ? 'Ollama rejected the request. Is it running at OLLAMA_BASE_URL?'
        : 'authentication failed, check OPENAI_API_KEY'
    }
    if (error.status === 404 && flavour === 'ollama') {
      return `model "${env().OLLAMA_MODEL}" not found. Run: ollama pull ${env().OLLAMA_MODEL}`
    }
    if (error.status === 429) return 'rate limited by the provider'
    return `request failed (${error.status}): ${error.message}`
  }
  if (error instanceof Error && 'code' in error && error.code === 'ECONNREFUSED') {
    return flavour === 'ollama'
      ? `cannot reach Ollama at ${env().OLLAMA_BASE_URL}. Run: ollama serve`
      : 'connection refused'
  }
  return error instanceof Error ? error.message : String(error)
}
