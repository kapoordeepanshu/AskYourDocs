/**
 * The whole provider surface the rest of the app is allowed to depend on.
 *
 * Kept this small on purpose: every method here has to be implementable by a
 * hosted API and by a local model behind Ollama. Anything provider-specific
 * (tool use, prompt caching, structured output modes) stays inside an adapter
 * rather than leaking into retrieval or the interface.
 */

export type ChatRole = 'user' | 'assistant'

export interface ChatMessage {
  role: ChatRole
  content: string
}

export interface GenerateOptions {
  /** Prepended as a system prompt. Sent separately where the API supports it. */
  system?: string
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
}

export interface Usage {
  promptTokens?: number
  completionTokens?: number
}

export interface CompletionResult {
  text: string
  usage: Usage
  model: string
}

export interface LlmProvider {
  readonly name: 'anthropic' | 'openai' | 'ollama'
  readonly model: string

  /** Streaming generation, used for the answer the user is watching. */
  stream(messages: ChatMessage[], options?: GenerateOptions): AsyncIterable<string>

  /**
   * Single-shot generation. Used by reranking and citation verification, where
   * nothing is rendered until the call finishes and streaming would only add
   * bookkeeping.
   */
  complete(messages: ChatMessage[], options?: GenerateOptions): Promise<CompletionResult>
}

export interface EmbeddingProvider {
  readonly name: 'openai' | 'ollama'
  readonly model: string
  readonly dimensions: number

  /**
   * Order of the returned vectors must match the input order. Adapters batch
   * internally; callers pass whatever they have.
   */
  embed(texts: string[]): Promise<number[][]>
}

/** Thrown when a provider fails in a way worth showing the user verbatim. */
export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    readonly cause?: unknown,
  ) {
    super(`[${provider}] ${message}`)
    this.name = 'ProviderError'
  }
}
