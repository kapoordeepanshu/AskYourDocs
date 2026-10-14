import { z } from 'zod'

/**
 * Fail at boot, not at the first request. A self-hoster who mistypes a variable
 * should find out when the container starts, with a message naming the field.
 */

const bool = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? fallback : v === 'true' || v === '1'))

const int = (fallback: number) =>
  z.coerce.number().int().positive().optional().default(fallback)

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    APP_URL: z.string().url().default('http://localhost:3000'),

    SESSION_SECRET: z
      .string()
      .min(32, 'SESSION_SECRET must be at least 32 characters. Generate: openssl rand -base64 48'),

    DATABASE_URL: z.string().url(),
    /**
     * Set when DATABASE_URL points at a transaction-mode pooler (Supabase on
     * port 6543, PgBouncer). Those cannot hold prepared statements across
     * transactions, so the driver must not create any.
     */
    DATABASE_POOLER: bool(false),

    LLM_PROVIDER: z.enum(['anthropic', 'openai', 'groq', 'ollama']).default('anthropic'),
    EMBEDDING_PROVIDER: z.enum(['openai', 'ollama']).default('openai'),

    ANTHROPIC_API_KEY: z.string().optional(),
    ANTHROPIC_MODEL: z.string().default('claude-sonnet-5'),

    OPENAI_API_KEY: z.string().optional(),
    OPENAI_MODEL: z.string().default('gpt-4o-mini'),
    OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),

    GROQ_API_KEY: z.string().optional(),
    GROQ_MODEL: z.string().default('llama-3.3-70b-versatile'),

    OLLAMA_BASE_URL: z.string().url().default('http://localhost:11434/v1'),
    OLLAMA_MODEL: z.string().default('llama3.1:8b'),
    OLLAMA_EMBEDDING_MODEL: z.string().default('nomic-embed-text'),

    EMBEDDING_DIMENSIONS: int(1536),

    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    LOCAL_STORAGE_PATH: z.string().default('./data/uploads'),
    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: bool(true),

    /**
     * `worker` hands ingestion to the background worker (npm run worker).
     * `inline` runs it in the upload request after the response is sent, for
     * hosts with no long-running process such as Vercel.
     */
    INGEST_MODE: z.enum(['worker', 'inline']).default(process.env.VERCEL ? 'inline' : 'worker'),

    MAX_UPLOAD_MB: int(25),
    CHUNK_SIZE_TOKENS: int(800),
    CHUNK_OVERLAP_TOKENS: int(120),

    URL_FETCH_TIMEOUT_MS: int(15_000),
    URL_FETCH_MAX_BYTES: int(10 * 1024 * 1024),
    ALLOW_PRIVATE_NETWORK_FETCH: bool(false),

    RETRIEVAL_CANDIDATES: int(40),
    RETRIEVAL_TOP_K: int(8),
    RETRIEVAL_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.25),
    RERANK_ENABLED: bool(true),

    ALLOW_PUBLIC_REGISTRATION: bool(true),

    /** Questions one visitor may ask a website widget per hour. */
    WIDGET_VISITOR_HOURLY_LIMIT: int(30),
    /** Questions a single widget may answer per day, across all visitors. */
    WIDGET_DAILY_LIMIT: int(1000),
  })
  .superRefine((env, ctx) => {
    const missing = (key: string, why: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: why })

    if (env.LLM_PROVIDER === 'anthropic' && !env.ANTHROPIC_API_KEY) {
      missing('ANTHROPIC_API_KEY', 'required when LLM_PROVIDER=anthropic')
    }
    if (env.LLM_PROVIDER === 'groq' && !env.GROQ_API_KEY) {
      missing('GROQ_API_KEY', 'required when LLM_PROVIDER=groq')
    }
    if (
      (env.LLM_PROVIDER === 'openai' || env.EMBEDDING_PROVIDER === 'openai') &&
      !env.OPENAI_API_KEY
    ) {
      missing('OPENAI_API_KEY', 'required when either provider is set to openai')
    }
    if (env.STORAGE_DRIVER === 's3' && !(env.S3_BUCKET && env.S3_ACCESS_KEY_ID)) {
      missing('S3_BUCKET', 'S3_BUCKET and S3_ACCESS_KEY_ID are required when STORAGE_DRIVER=s3')
    }
    if (process.env.VERCEL && env.STORAGE_DRIVER === 'local') {
      missing(
        'STORAGE_DRIVER',
        'Vercel has no persistent disk. Use STORAGE_DRIVER=s3 (Supabase Storage, R2, or S3)',
      )
    }
    if (process.env.VERCEL && env.INGEST_MODE === 'worker') {
      missing('INGEST_MODE', 'Vercel cannot run the background worker. Use INGEST_MODE=inline')
    }
    if (env.CHUNK_OVERLAP_TOKENS >= env.CHUNK_SIZE_TOKENS) {
      missing('CHUNK_OVERLAP_TOKENS', 'must be smaller than CHUNK_SIZE_TOKENS')
    }
    if (env.RETRIEVAL_TOP_K > env.RETRIEVAL_CANDIDATES) {
      missing('RETRIEVAL_TOP_K', 'cannot exceed RETRIEVAL_CANDIDATES')
    }
    if (env.NODE_ENV === 'production' && env.ALLOW_PRIVATE_NETWORK_FETCH) {
      missing(
        'ALLOW_PRIVATE_NETWORK_FETCH',
        'refusing to start: this disables SSRF protection and must stay false in production',
      )
    }
  })

function load() {
  const parsed = schema.safeParse(process.env)
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`)
  }
  return parsed.data
}

export type Env = z.infer<typeof schema>

let cached: Env | undefined

/** Lazy so that importing a module does not force validation during a build. */
export function env(): Env {
  cached ??= load()
  return cached
}
