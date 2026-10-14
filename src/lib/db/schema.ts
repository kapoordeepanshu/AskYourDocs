import { sql } from 'drizzle-orm'
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core'

/**
 * Embedding width is fixed at table-creation time, so it cannot be changed
 * without re-indexing every chunk. Keep this in step with EMBEDDING_DIMENSIONS
 * and the model named in EMBEDDING_PROVIDER.
 */
export const EMBEDDING_DIMENSIONS = Number(process.env.EMBEDDING_DIMENSIONS ?? 1536)

/** Postgres full-text vector. Maintained by a trigger, never written from app code. */
const tsvector = customType<{ data: string }>({
  dataType: () => 'tsvector',
})

// ─── Enums ──────────────────────────────────────────────────────────────────

export const userRole = pgEnum('user_role', ['admin', 'member'])

export const sourceType = pgEnum('source_type', ['pdf', 'docx', 'html', 'markdown', 'text', 'url'])

export const documentStatus = pgEnum('document_status', [
  'pending', // accepted, waiting for a worker
  'parsing', // extracting text
  'chunking',
  'embedding',
  'ready',
  'failed',
])

export const messageRole = pgEnum('message_role', ['user', 'assistant'])

/**
 * Outcome of checking one cited sentence against the passage it cites.
 * `unchecked` means verification was disabled or the pass itself errored —
 * it is deliberately distinct from `unsupported` so the interface never
 * implies a claim was validated when it wasn't.
 */
export const citationVerdict = pgEnum('citation_verdict', [
  'supported',
  'partial',
  'unsupported',
  'unchecked',
])

export const jobStatus = pgEnum('job_status', ['queued', 'running', 'succeeded', 'failed'])

// ─── Identity ───────────────────────────────────────────────────────────────

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    name: text('name'),
    role: userRole('role').notNull().default('member'),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('users_email_lower_idx').on(sql`lower(${t.email})`)],
)

/**
 * `id` stores a SHA-256 hash of the session token, not the token itself, so a
 * database leak does not hand over live sessions.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
)

// ─── Documents ──────────────────────────────────────────────────────────────

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    title: text('title').notNull(),
    sourceType: sourceType('source_type').notNull(),
    /** Canonical URL for url-sourced documents, null for uploads. */
    sourceUrl: text('source_url'),
    /** Original filename for uploads. */
    filename: text('filename'),
    mimeType: text('mime_type'),
    byteSize: integer('byte_size'),
    /** Key in the storage driver. Null once the original is discarded. */
    storageKey: text('storage_key'),

    /** SHA-256 of the raw bytes. Powers dedup and URL change detection. */
    contentHash: text('content_hash'),

    status: documentStatus('status').notNull().default('pending'),
    /** Populated only when status is 'failed'. Surfaced to the owner. */
    error: text('error'),
    pageCount: integer('page_count'),
    chunkCount: integer('chunk_count').notNull().default(0),

    /** When the URL was last fetched. Drives the "content changed" prompt. */
    fetchedAt: timestamp('fetched_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('documents_owner_created_idx').on(t.ownerId, t.createdAt.desc()),
    index('documents_owner_status_idx').on(t.ownerId, t.status),
    // Same bytes, same owner, ingested twice is a no-op rather than a duplicate.
    uniqueIndex('documents_owner_hash_idx')
      .on(t.ownerId, t.contentHash)
      .where(sql`${t.contentHash} is not null`),
  ],
)

/**
 * `ownerId` is denormalised from the parent document on purpose. Every
 * retrieval query filters on it directly, so isolation holds inside the SQL
 * predicate rather than depending on a correct join. Filtering after retrieval
 * is how cross-tenant leaks happen.
 */
export const chunks = pgTable(
  'chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** Position within the document, 0-based. */
    ordinal: integer('ordinal').notNull(),
    content: text('content').notNull(),
    tokenCount: integer('token_count').notNull(),

    /**
     * Where this text came from, so a citation can point at something a human
     * can open: { page } for PDFs, { heading, anchor } for HTML, plus
     * { charStart, charEnd } into the normalised document text.
     */
    locator: jsonb('locator').notNull().$type<ChunkLocator>(),

    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }),
    /** Generated by trigger from `content`. */
    searchVector: tsvector('search_vector'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('chunks_document_ordinal_idx').on(t.documentId, t.ordinal),
    index('chunks_owner_idx').on(t.ownerId),
    index('chunks_document_idx').on(t.documentId),
    // HNSW beats IVFFlat here: no training step, and recall stays good as the
    // corpus grows one upload at a time.
    index('chunks_embedding_hnsw_idx')
      .using('hnsw', t.embedding.op('vector_cosine_ops'))
      .with({ m: 16, ef_construction: 64 }),
    index('chunks_search_vector_idx').using('gin', t.searchVector),
  ],
)

/** Snapshot of one passage as it was presented to the model. */
export type StoredSource = {
  n: number
  chunkId: string
  documentId: string
  title: string
  location: string | null
  sourceUrl: string | null
  excerpt: string
}

export type ChunkLocator = {
  charStart: number
  charEnd: number
  /** PDF and DOCX. */
  page?: number
  /** HTML, Markdown, and URL sources. */
  heading?: string
  anchor?: string
}

// ─── Conversations ──────────────────────────────────────────────────────────

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull().default('New conversation'),
    /**
     * Set for conversations held by a website visitor through an embedded
     * widget. Those belong to the widget owner for retrieval and accounting,
     * but stay out of the owner's own chat history.
     */
    widgetId: uuid('widget_id').references(() => widgets.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('conversations_owner_updated_idx').on(t.ownerId, t.updatedAt.desc()),
    index('conversations_widget_idx').on(t.widgetId, t.createdAt.desc()),
  ],
)

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: messageRole('role').notNull(),
    content: text('content').notNull(),

    /**
     * Share of cited sentences that survived verification, 0-100. Null for user
     * messages and for answers that were a grounded refusal.
     */
    groundingScore: smallint('grounding_score'),
    /** True when retrieval fell below RETRIEVAL_MIN_SCORE and we declined to answer. */
    refused: boolean('refused').notNull().default(false),

    /**
     * The passages this answer was given, in the order the [n] markers refer
     * to. Stored on the message rather than derived later because retrieval is
     * not deterministic across re-index or model changes: without this, an old
     * answer's citation markers would eventually point at the wrong passages.
     */
    sources: jsonb('sources').$type<StoredSource[]>(),

    /** Provider and model that produced this, for reproducibility. */
    model: text('model'),
    promptTokens: integer('prompt_tokens'),
    completionTokens: integer('completion_tokens'),
    latencyMs: integer('latency_ms'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('messages_conversation_created_idx').on(t.conversationId, t.createdAt)],
)

/**
 * One row per (sentence, cited chunk) pair. Verification writes `verdict` here,
 * which is what lets the interface strike through a claim its own source does
 * not actually support.
 */
export const citations = pgTable(
  'citations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    chunkId: uuid('chunk_id').references(() => chunks.id, { onDelete: 'set null' }),
    /** Kept so a citation still renders after its document is deleted. */
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),

    /** Index of the sentence in the answer that carries this citation. */
    sentenceIndex: integer('sentence_index').notNull(),
    /** The sentence as generated, snapshotted for auditability. */
    sentence: text('sentence').notNull(),
    /** Retrieval score of the cited chunk for this question. */
    retrievalScore: text('retrieval_score'),

    verdict: citationVerdict('verdict').notNull().default('unchecked'),
    /** Why the verifier ruled the way it did. Shown on hover. */
    verdictReason: text('verdict_reason'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('citations_message_idx').on(t.messageId, t.sentenceIndex),
    index('citations_chunk_idx').on(t.chunkId),
  ],
)

// ─── Website widgets ────────────────────────────────────────────────────────

/**
 * A public chat box a user embeds on their own website, answering visitors
 * from that user's documents.
 *
 * `publicKey` is not a secret: it sits in the page source of every site the
 * widget is embedded on. What protects the owner is the origin allowlist, the
 * document scope, and the rate limits, not the key.
 */
export const widgets = pgTable(
  'widgets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    publicKey: text('public_key').notNull(),

    /** Internal label, shown only to the owner. */
    name: text('name').notNull(),
    /** Header of the chat panel visitors see. */
    title: text('title').notNull(),
    greeting: text('greeting').notNull(),
    /** Shown instead of an answer when the documents do not cover the question. */
    fallbackMessage: text('fallback_message').notNull(),
    accentColor: text('accent_color').notNull().default('#2563eb'),

    /** Exact origins such as https://example.com, or https://*.example.com. Empty allows any. */
    allowedOrigins: text('allowed_origins').array().notNull().default(sql`'{}'::text[]`),
    /** Documents the widget may answer from. Null means every ready document the owner has. */
    documentIds: uuid('document_ids').array(),

    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('widgets_public_key_idx').on(t.publicKey),
    index('widgets_owner_idx').on(t.ownerId, t.createdAt.desc()),
  ],
)

/**
 * Fixed-window counters for the public widget endpoints. Kept in Postgres
 * because serverless instances share no memory, and a per-instance counter
 * would multiply the real limit by however many instances happen to be warm.
 */
export const rateLimits = pgTable('rate_limits', {
  key: text('key').primaryKey(),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
  count: integer('count').notNull(),
})

// ─── Jobs ───────────────────────────────────────────────────────────────────

/**
 * A Postgres-backed queue, claimed with SELECT ... FOR UPDATE SKIP LOCKED.
 * Adding Redis for this workload would be one more thing for a self-hoster to
 * run and back up.
 */
export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    status: jobStatus('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    lastError: text('last_error'),
    /** Set in the future for exponential backoff on retry. */
    runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('jobs_claim_idx').on(t.status, t.runAt)],
)

// ─── Audit ──────────────────────────────────────────────────────────────────

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Null when the actor was deleted; the record itself is retained. */
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    metadata: jsonb('metadata'),
    ipAddress: text('ip_address'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_created_idx').on(t.createdAt.desc()),
    index('audit_log_actor_idx').on(t.actorId, t.createdAt.desc()),
  ],
)

// ─── Inferred types ─────────────────────────────────────────────────────────

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Document = typeof documents.$inferSelect
export type NewDocument = typeof documents.$inferInsert
export type Chunk = typeof chunks.$inferSelect
export type NewChunk = typeof chunks.$inferInsert
export type Conversation = typeof conversations.$inferSelect
export type Message = typeof messages.$inferSelect
export type Citation = typeof citations.$inferSelect
export type Job = typeof jobs.$inferSelect
export type Widget = typeof widgets.$inferSelect
