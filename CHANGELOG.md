# Changelog

All notable changes to this project are documented here.
This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Embeddable website widget: one script tag adds a chat bubble that answers
  visitors from the owner's documents, with a source passage behind every
  citation and verifier-rejected sentences removed from the final answer
- Per-widget title, greeting, colour, fallback message, document scope, and
  allowed websites with `*.` subdomain wildcards
- Postgres-backed rate limits per visitor and per widget
  (`WIDGET_VISITOR_HOURLY_LIMIT`, `WIDGET_DAILY_LIMIT`)
- Website widget dashboard with install snippet, preview page, 30-day
  statistics, and the latest questions the widget could not answer
- Groq as a chat provider (`LLM_PROVIDER=groq`)
- `INGEST_MODE=inline` to ingest without a worker, the default on Vercel
- `DATABASE_POOLER` for transaction-mode poolers such as Supabase's
- Vercel and Supabase deployment guide
- Answers in the language of the question

- Email and password authentication with server-side sessions, roles, and an audit log
- Document upload for PDF, DOCX, HTML, Markdown, and plain text
- URL import behind an SSRF guard: scheme allowlist, per-address DNS checks,
  manually re-validated redirects, and a streaming byte cap
- Background ingestion worker on a Postgres job queue, with progress reported
  between embedding batches
- Hybrid retrieval combining pgvector similarity and Postgres full-text search,
  fused with Reciprocal Rank Fusion
- Streaming chat with inline citations and conversation history
- Citation verification: every cited sentence checked against the passage it
  cites, surfaced as a grounding score and per-claim markers
- Grounded refusal when retrieval falls below the configured threshold
- Search across documents using the same retrieval path as chat
- Admin console with user management, configuration summary, and failed jobs
- Docker Compose deployment with Postgres, pgvector, app, and worker

### Fixed

- Sentence splitting for verification now recognises accented capitals, so
  French and German answers are checked sentence by sentence
- The admin console named the Ollama model when Groq was configured
