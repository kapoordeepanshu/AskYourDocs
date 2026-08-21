<div align="center">

# AskYourDocs

### Open-Source, Self-Hosted Document Q&A That Refuses to Answer Without a Verified Citation

[![CI](https://img.shields.io/github/actions/workflow/status/kapoordeepanshu/AskYourDocs/ci.yml?branch=main&style=for-the-badge&label=CI)](https://github.com/kapoordeepanshu/AskYourDocs/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-Apache_2.0-yellow?style=for-the-badge)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js_15-000000?style=for-the-badge&logo=next.js&logoColor=white)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://typescriptlang.org)
[![pgvector](https://img.shields.io/badge/Postgres_+_pgvector-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://github.com/pgvector/pgvector)
[![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://docker.com)

**Upload PDFs, Word documents, HTML files, or paste a URL — then ask questions in plain English
and get answers grounded in your own documents, with citations that are checked before you see them.**

Runs entirely on your own infrastructure. Works with any major LLM API, or **fully offline with Ollama**.

[Quick start](#quick-start-2-minutes) · [Why this exists](#why-another-document-chatbot) · [How it works](#how-it-works) · [Comparison](#how-it-compares) · [FAQ](#faq)

<br />

<img src="docs/images/preview.png" width="900" alt="The AskYourDocs chat interface answering a question about a refund policy. Two claims carry citations that check out. A third claim is underlined in red and tagged unverified, and the answer shows a 67% grounded badge. A follow-up question gets a plain refusal because nothing in the documents answers it." />

<sub><i>Interface mockup. The third claim is not supported by the passage it cites, so it is flagged rather than presented as fact.</i></sub>

</div>

---

> [!WARNING]
> **Status: v0.1, feature-complete but not yet battle-tested.** Everything described below is
> implemented, typechecked, and unit-tested, but it has not run in production anywhere yet.
> Expect rough edges, and please report them. See the [roadmap](#roadmap) for what is still missing.

---

## Contents

1. [Why another document chatbot?](#why-another-document-chatbot)
2. [Features](#features)
3. [Quick start (2 minutes)](#quick-start-2-minutes)
4. [How it works](#how-it-works)
5. [How it compares](#how-it-compares)
6. [Configuration](#configuration)
7. [Architecture](#architecture)
8. [Roadmap](#roadmap)
9. [FAQ](#faq)
10. [Contributing](#contributing)

---

## Why another document chatbot?

Because most of them will lie to you politely.

Ask a typical RAG chatbot a question about your documents and it returns a confident paragraph with a
little `[1]` next to it. That citation is what makes you trust the answer. But often the cited passage
**does not actually support the sentence attached to it** — the retriever pulled a loosely related
chunk, and the model bridged the gap with invented logic. The research literature calls these
*citation-shaped hallucinations*, and they are more dangerous than an obviously wrong answer, because
the citation is the very thing that stops you from checking.

**AskYourDocs treats an unverified citation as a bug.**

After an answer is generated, every sentence is checked against the specific passage it cites.
Sentences that aren't supported are flagged or removed, and each answer carries a grounding score.
When retrieval finds nothing relevant, you get *"That isn't in your documents"* — not a guess.

Three more things, each from a real complaint about existing tools:

- **Big documents don't break it.** Popular alternatives tell users to split PDFs into 50-page segments
  to avoid running out of memory. Here, parsing and embedding run in a background worker with streaming
  and batching, so a 900-page manual is a job that takes a while, not a crash.
- **Real multi-user isolation.** Every query is filtered by owner *inside* the SQL, not after retrieval.
  Users see only their own documents, and admins get a full audit log.
- **No vendor lock-in.** One provider interface, three adapters. Bring an API key, or run completely
  offline with Ollama on your own hardware.

---

## Features

**Documents**

- Upload **PDF**, **DOCX**, **HTML**, **Markdown**, and **plain text**
- **Paste a URL** — the page is fetched server-side, stripped of navigation and boilerplate, and indexed
- Background ingestion with live progress, so large files never block the UI
- Full-text and semantic **search across all your documents**
- Re-index on demand, and detect when a URL's content has changed

**Answers**

- Conversational Q&A over your own documents, streamed as they are written
- **Verified citations** — every claim checked against the passage it cites
- Click a citation to jump to the exact page or heading it came from
- Grounded refusal when the answer genuinely isn't in your documents
- Conversation history, saved per user

**Teams and security**

- Email and password authentication with secure server-side sessions
- Per-user document isolation enforced at the query layer
- Roles (admin, member), an admin console, and an audit log
- **SSRF-hardened URL fetching** with private-network and redirect guards
- Your documents and embeddings never leave your server

**Operations**

- `docker compose up` — Postgres with pgvector, the app, and the worker. No external accounts.
- Deploys to any VPS, or to Vercel with a managed Postgres
- Provider-agnostic: any major LLM API, or Ollama with no API key at all
- Responsive interface, light and dark

---

## Quick start (2 minutes)

**Requirements:** Docker, plus either an LLM API key or [Ollama](https://ollama.com) for fully offline use.

```bash
git clone https://github.com/kapoordeepanshu/AskYourDocs.git
cd AskYourDocs
cp .env.example .env
```

Open `.env` and set two things — a session secret and your provider:

```bash
SESSION_SECRET=$(openssl rand -base64 48)

# Option A - hosted API (best answer quality)
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=sk-...

# Option B - fully offline. No API key, nothing leaves your machine.
# LLM_PROVIDER=ollama
# EMBEDDING_PROVIDER=ollama
# EMBEDDING_DIMENSIONS=768
```

Then:

```bash
docker compose up
```

Open **http://localhost:3000**. The first account you register becomes the admin.

---

## How it works

```
┌── Ingest ────────────────────────────────────────────────────────────┐
│   PDF ─┐                                                             │
│  DOCX ─┼─► adapter ─► normalized text + structure ─► chunk ─► embed ─┼─┐
│  HTML ─┤   per source    pages, headings, offsets                    │ │
│   URL ─┘   SSRF-guarded fetch ─► readability ─► markdown             │ │
└──────────────────────────────────────────────────────────────────────┘ │
                                                                         ▼
                                                       Postgres + pgvector
                                                  chunks · vectors · tsvector
┌── Ask ───────────────────────────────────────────────────────────────┐
│  question ─► hybrid retrieval ─► rerank ─► generate ─► VERIFY ─► UI  │
│              vector + keyword     top-k     with       each claim    │
│              fused with RRF                 citations  vs its source │
│              scoped to this user                                     │
└──────────────────────────────────────────────────────────────────────┘
```

**Retrieval is hybrid.** pgvector cosine similarity for meaning, Postgres full-text search for exact
terms and identifiers, fused with Reciprocal Rank Fusion. Pure vector search reliably misses error
codes and part numbers; pure keyword search misses paraphrases. You need both.

**Verification is the part most implementations skip.** The generator must attach a chunk ID to every
sentence. A second, cheap pass then asks: does this specific passage support this specific sentence?
Unsupported sentences are marked in the interface and excluded from the grounding score.

**Isolation lives in the SQL predicate**, so a retrieval bug cannot leak another user's document.
Filtering after the fact is how data leaks happen.

---

## How it compares

|                                        | **AskYourDocs** | AnythingLLM | Open WebUI | Build your own |
| -------------------------------------- | :-------------: | :---------: | :--------: | :------------: |
| Self-hosted, no external accounts      |       yes       |     yes     |    yes     |      yes       |
| Chat with PDF, DOCX, HTML              |       yes       |     yes     |    yes     |  you build it  |
| Ingest a URL directly                  |       yes       |     yes     |  partial   |  you build it  |
| Inline citations                       |       yes       |     yes     |    yes     |  you build it  |
| **Citations verified against source**  |     **yes**     |     no      |     no     |       no       |
| **Grounded refusal when unsure**       |     **yes**     |   partial   |  partial   |  you build it  |
| Hybrid vector and keyword retrieval    |       yes       |   partial   |  partial   |  you build it  |
| Multi-user with per-user isolation     |       yes       |     yes     |    yes     |       no       |
| Shared team collections                |    roadmap      |     yes     |    yes     |       no       |
| Admin console and audit log            |       yes       |   partial   |  partial   |       no       |
| Large documents without manual splits  |       yes       |   partial   |  partial   |  you build it  |
| Runs fully offline with Ollama         |       yes       |     yes     |    yes     |      yes       |
| Single Postgres, no separate vector DB |       yes       |   partial   |  partial   |       no       |

AnythingLLM and Open WebUI are excellent, mature projects with far more integrations than this one.
AskYourDocs is narrower on purpose: a team document assistant whose answers you can trust without
re-reading the source every time.

---

## Configuration

Everything is environment variables. See [`.env.example`](.env.example) for the annotated list.

| Variable                     | Default     | What it does                                                     |
| ---------------------------- | ----------- | ---------------------------------------------------------------- |
| `LLM_PROVIDER`               | `anthropic` | `anthropic`, `openai`, or `ollama`                                |
| `EMBEDDING_PROVIDER`         | `openai`    | `openai` or `ollama`                                              |
| `EMBEDDING_DIMENSIONS`       | `1536`      | Must match your embedding model; changing it means re-indexing    |
| `RETRIEVAL_TOP_K`            | `8`         | Passages sent to the model                                        |
| `RETRIEVAL_MIN_SCORE`        | `0.25`      | Below this the app refuses instead of guessing                    |
| `RERANK_ENABLED`             | `true`      | Rerank candidates before answering                                |
| `ALLOW_PRIVATE_NETWORK_FETCH`| `false`     | SSRF guard for URL ingestion. Leave off in production.            |
| `ALLOW_PUBLIC_REGISTRATION`  | `true`      | Turn off to make the instance admin-invite only                   |
| `STORAGE_DRIVER`             | `local`     | `local` disk, or `s3` for MinIO, R2, or S3                        |

---

## Architecture

| Layer     | Choice                                        | Why                                                      |
| --------- | --------------------------------------------- | -------------------------------------------------------- |
| Web + API | Next.js 15 App Router, TypeScript             | One codebase, one deploy target, streaming built in       |
| Database  | Postgres 16 with pgvector                     | Vectors, full-text, and relational data in one place      |
| Storage   | Local disk, or any S3-compatible store        | Self-hosting shouldn't require a cloud account            |
| Worker    | Node process on a Postgres job queue          | No Redis, and ingestion survives restarts                 |
| Auth      | Server-side sessions, bcrypt, httpOnly cookies| Auditable, with no third-party identity provider          |
| LLM       | Adapter interface with three implementations  | Swap providers with one environment variable              |

Deliberately **not** using LangChain. For a pipeline this shape it adds indirection over retrieval and
prompting — the two things that most determine answer quality — while saving very little code.

---

## Roadmap

**Built**

- [x] Project scaffold, Docker Compose, schema design
- [x] Auth, sessions, roles, and the audit trail
- [x] Ingestion adapters for PDF, DOCX, HTML, Markdown, text, and URL
- [x] SSRF-hardened URL fetching
- [x] Chunking, embeddings, and the background worker
- [x] Hybrid retrieval with Reciprocal Rank Fusion
- [x] Streaming chat with inline citations and conversation history
- [x] Citation verification pass and grounding score
- [x] Grounded refusal below the retrieval threshold
- [x] Admin console, user management, failed-job view
- [x] Search across documents

**Next**

- [ ] Evaluation harness with a public benchmark set
- [ ] Team collections and shared documents
- [ ] OCR for scanned PDFs
- [ ] Headless-browser fallback for JavaScript-rendered pages
- [ ] Password reset and email invitations

---

## FAQ

<details>
<summary><b>Is AskYourDocs free and open source?</b></summary>

Yes, Apache 2.0. Self-host it commercially, fork it, embed it in your own product.

</details>

<details>
<summary><b>Can I use it without any API key?</b></summary>

Yes. Set `LLM_PROVIDER=ollama` and `EMBEDDING_PROVIDER=ollama`. Nothing leaves your machine, there is
no per-token billing, and it works on air-gapped networks.

</details>

<details>
<summary><b>Do my documents get sent anywhere?</b></summary>

Only to the LLM provider you configure, and only the passages relevant to a given question. With Ollama,
nothing is sent anywhere at all. Files and embeddings are stored on your own infrastructure.

</details>

<details>
<summary><b>How is this different from uploading a PDF to a chatbot?</b></summary>

Persistence and trust. Your documents stay indexed across sessions and users, retrieval scales to
thousands of files, answers cite exact pages, and those citations are verified. Your data also stays
on your own servers.

</details>

<details>
<summary><b>Can it handle scanned PDFs?</b></summary>

Not yet. OCR is on the roadmap; today a PDF needs a text layer.

</details>

<details>
<summary><b>How large a document library can it handle?</b></summary>

pgvector handles into the millions of chunks with an HNSW index, which is realistically tens of
thousands of documents on a modest VPS.

</details>

<details>
<summary><b>Can several people share one instance?</b></summary>

Yes, that's the point. Each person sees only their own documents, and admins manage users and review
an audit log.

</details>

<details>
<summary><b>Which vector database does it use?</b></summary>

None. Postgres with pgvector. One database to operate and back up, and no risk of vectors drifting out
of sync with their metadata.

</details>

---

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md); good first issues are
labelled. If you are reporting a wrong or ungrounded answer, please include the question, the document,
and the citation that didn't hold up. That is the single most valuable bug report this project can get.

## Security

Found a vulnerability? Please read [SECURITY.md](SECURITY.md) instead of opening a public issue.

## License

[Apache 2.0](LICENSE) © [Deepanshu Kapoor](https://github.com/kapoordeepanshu)

---

<div align="center">

**Keywords:** open source chat with your documents · self-hosted document Q&A · chat with PDF · AI document assistant · RAG chatbot with citations · document AI for teams · private LLM · Ollama RAG · pgvector RAG · Next.js RAG application · AnythingLLM alternative · multi-user document chat · on-premise AI knowledge base · ask questions about your PDFs

If this is useful, a ⭐ helps other people find it.

</div>
