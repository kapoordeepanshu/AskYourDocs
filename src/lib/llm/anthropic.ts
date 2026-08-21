import Anthropic from '@anthropic-ai/sdk'

import { env } from '@/lib/env'
import {
  type ChatMessage,
  type CompletionResult,
  type GenerateOptions,
  type LlmProvider,
  ProviderError,
} from './types'

const DEFAULT_MAX_TOKENS = 2048

export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic' as const
  readonly model: string
  private client: Anthropic

  constructor() {
    const key = env().ANTHROPIC_API_KEY
    if (!key) throw new ProviderError('anthropic', 'ANTHROPIC_API_KEY is not set')
    this.client = new Anthropic({ apiKey: key })
    this.model = env().ANTHROPIC_MODEL
  }

  async *stream(messages: ChatMessage[], options: GenerateOptions = {}) {
    try {
      const response = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
          temperature: options.temperature ?? 0,
          ...(options.system ? { system: options.system } : {}),
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          stream: true,
        },
        { signal: options.signal },
      )

      for await (const event of response) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield event.delta.text
        }
      }
    } catch (error) {
      // An aborted stream is the user navigating away, not a failure.
      if (options.signal?.aborted) return
      throw new ProviderError('anthropic', describe(error), error)
    }
  }

  async complete(
    messages: ChatMessage[],
    options: GenerateOptions = {},
  ): Promise<CompletionResult> {
    try {
      const response = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
          temperature: options.temperature ?? 0,
          ...(options.system ? { system: options.system } : {}),
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
        },
        { signal: options.signal },
      )

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('')

      return {
        text,
        model: response.model,
        usage: {
          promptTokens: response.usage.input_tokens,
          completionTokens: response.usage.output_tokens,
        },
      }
    } catch (error) {
      throw new ProviderError('anthropic', describe(error), error)
    }
  }
}

function describe(error: unknown): string {
  if (error instanceof Anthropic.APIError) {
    // 401 and 429 are the two a self-hoster actually hits, so name them.
    if (error.status === 401) return 'authentication failed, check ANTHROPIC_API_KEY'
    if (error.status === 429) return 'rate limited by the provider'
    return `request failed (${error.status}): ${error.message}`
  }
  return error instanceof Error ? error.message : String(error)
}
