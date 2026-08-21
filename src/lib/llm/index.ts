import { env } from '@/lib/env'
import { AnthropicProvider } from './anthropic'
import { OpenAiCompatibleEmbeddings, OpenAiCompatibleProvider } from './openai'
import type { EmbeddingProvider, LlmProvider } from './types'

export * from './types'

let llm: LlmProvider | undefined
let embeddings: EmbeddingProvider | undefined

/** The chat model, selected by LLM_PROVIDER. */
export function getLlm(): LlmProvider {
  if (!llm) {
    switch (env().LLM_PROVIDER) {
      case 'anthropic':
        llm = new AnthropicProvider()
        break
      case 'openai':
        llm = new OpenAiCompatibleProvider('openai')
        break
      case 'ollama':
        llm = new OpenAiCompatibleProvider('ollama')
        break
    }
  }
  return llm as LlmProvider
}

/**
 * Embeddings are configured separately from chat. Pairing a strong hosted chat
 * model with cheap local embeddings, or the reverse, is common enough to be a
 * first-class option rather than something you fork the code for.
 */
export function getEmbeddings(): EmbeddingProvider {
  embeddings ??= new OpenAiCompatibleEmbeddings(env().EMBEDDING_PROVIDER)
  return embeddings
}

/** Test seam: drop the cached singletons after changing environment variables. */
export function resetProviders() {
  llm = undefined
  embeddings = undefined
}
