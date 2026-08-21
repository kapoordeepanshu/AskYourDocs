# Changelog

All notable changes to this project are documented here.
This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
