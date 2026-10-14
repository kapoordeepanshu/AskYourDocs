<div align="center">

# AskYourDocs

### Open-Source, Self-Hosted Document Q&A That Refuses to Answer Without a Verified Citation

[![CI](https://img.shields.io/github/actions/workflow/status/kapoordeepanshu/AskYourDocs/ci.yml?branch=main&style=for-the-badge&label=CI)](https://github.com/kapoordeepanshu/AskYourDocs/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-Apache_2.0-yellow?style=for-the-badge)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js_15-000000?style=for-the-badge&logo=next.js&logoColor=white)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://typescriptlang.org)
[![pgvector](https://img.shields.io/badge/Postgres_+_pgvector-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://github.com/pgvector/pgvector)
[![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://docker.com)

**Upload PDFs, Word documents, HTML files, or paste a URL — then ask questions in plain language
and get answers grounded in your own documents, with citations that are checked before you see them.**

Runs entirely on your own infrastructure. Works with any major LLM API, or **fully offline with Ollama**.
Put it on your own website with **one line of HTML**: visitors get the same verified, cited answers.

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
>
> The website widget, Groq provider, and Vercel + Supabase mode are newer still: typechecked,
> unit-tested, and building, but not yet exercised end to end against a live database and model.

---

## Contents

1. [Why another document chatbot?](#why-another-document-chatbot)
2. [Features](#features)
3. [Quick start (2 minutes)](#quick-start-2-minutes)
4. [Add it to your website](#add-it-to-your-website)
5. [Deploy on Vercel and Supabase](#deploy-on-vercel-and-supabase)
6. [How it works](#how-it-works)
7. [How it compares](#how-it-compares)
8. [Configuration](#configuration)
9. [Architecture](#architecture)
10. [Roadmap](#roadmap)
11. [FAQ](#faq)
12. [Contributing](#contributing)

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
- **No vendor lock-in.** One provider interface for Anthropic, OpenAI, Groq, and Ollama. Bring an API
  key, or run completely offline with Ollama on your own hardware.

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
- Replies in the language the question was asked in, even when the documents use another

**Website widget**

- A chat bubble for your own website, installed with **one `<script>` tag**
- Visitors get answers from the documents you choose, each with its source passage
- Sentences the verifier rejects are **removed before the visitor sees the final answer**
- Your own "I don't know" message, such as a phone number or email, instead of a guess
- Origin allowlist, per-visitor and per-day rate limits, and pause or delete at any time
- **Unanswered questions report**: see exactly what visitors asked that your documents don't cover

**Teams and security**

- Email and password authentication with secure server-side sessions
- Per-user document isolation enforced at the query layer
- Roles (admin, member), an admin console, and an audit log
- **SSRF-hardened URL fetching** with private-network and redirect guards
- Your documents and embeddings never leave your server

**Operations**

- `docker compose up` — Postgres with pgvector, the app, and the worker. No external accounts.
- Deploys to any VPS, or to **Vercel + Supabase** with no worker process ([guide](#deploy-on-vercel-and-supabase))
- Provider-agnostic: Anthropic, OpenAI, **Groq**, or Ollama with no API key at all
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

## Add it to your website

1. Upload the documents visitors should be able to ask about, such as FAQs, policies, and price lists.
2. Open **Website widget** and create a widget. Choose its title, greeting, colour, the message to
   show when the answer isn't in your documents, and which documents it may answer from.
3. Add your site under **Allowed websites**, for example `https://www.example.com` or
   `https://*.example.com`.
4. Copy the snippet and paste it before `</body>` on your site:

```html
<script src="https://docs.your-domain.com/widget.js" data-key="wk_..." async></script>
```

Optional: add `data-position="left"` to dock it bottom-left, or `data-open="true"` to start it open.
**Preview** opens a blank page with the widget on it, so you can try it before installing.

**What visitors get.** The answer streams in while it is written. Each citation is a numbered
button that opens the exact passage it came from. Once verification finishes, any sentence its
source doesn't support is removed and a short note says so. When retrieval finds nothing relevant,
the visitor sees your fallback message instead of a guess.

**What protects you.** The widget key is public by design; it sits in your page source. What
protects you is the origin allowlist (browsers report the embedding site truthfully), the document
scope, and the rate limits (`WIDGET_VISITOR_HOURLY_LIMIT`, `WIDGET_DAILY_LIMIT`). Visitor
conversations stay out of your own chat history. Keep internal documents out of a public widget's
scope: visitors can ask about anything in it.

**What it teaches you.** The widget page lists the latest questions it could not answer. Each one
is a gap in your documents, and adding a page that covers it fixes the answer for every visitor
after.

The widget is one dependency-free script that renders inside a shadow DOM, so your site's CSS
cannot break it and it cannot affect your site. It follows the visitor's light or dark preference,
goes full-screen on phones, and keeps the conversation while the visitor moves between pages.

---

## Deploy on Vercel and Supabase

No Docker and no worker process. Supabase provides Postgres with pgvector and file storage; Vercel
runs the app.

**1. Supabase.** Create a project. Under **Storage**, create a private bucket named `documents`,
then create S3 access keys under **Storage → S3 connection**. Note two connection strings from
**Connect**:

- the **transaction pooler** (port `6543`), which the app uses at runtime
- the **session pooler** (port `5432`), which migrations use

**2. Migrate.** From your machine, with the session pooler string:

```bash
DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-0-eu-central-1.pooler.supabase.com:5432/postgres" \
SESSION_SECRET=$(openssl rand -base64 48) npm run db:migrate
```

This enables `vector` and `pg_trgm` and creates every table.

**3. Vercel.** Import the repository and set these environment variables:

```bash
APP_URL=https://your-app.vercel.app
SESSION_SECRET=...                       # openssl rand -base64 48
DATABASE_URL=postgresql://...:6543/postgres
DATABASE_POOLER=true

LLM_PROVIDER=groq                        # or anthropic / openai
GROQ_API_KEY=gsk_...
EMBEDDING_PROVIDER=openai                # Groq has no embeddings
OPENAI_API_KEY=sk-...

STORAGE_DRIVER=s3
S3_ENDPOINT=https://xxxx.supabase.co/storage/v1/s3
S3_REGION=eu-central-1                   # your project's region
S3_BUCKET=documents
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_FORCE_PATH_STYLE=true
```

`INGEST_MODE` defaults to `inline` on Vercel: uploads are parsed and embedded in the same function
invocation after the response is sent, and the documents page shows progress as usual. The app
refuses to run on Vercel with local disk storage or worker mode, because neither would work there, and
the error names the variable to change.

**Limits worth knowing.** Inline ingestion has no automatic retry; a failed document says why and
has a **Re-index** button. Function duration caps how large one document can be. FAQ and policy
documents finish in seconds, but for long manuals run the Docker setup with a worker instead.

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
| Embeddable website chat widget         |       yes       |     yes     |     no     |  you build it  |
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
| `LLM_PROVIDER`               | `anthropic` | `anthropic`, `openai`, `groq`, or `ollama`                        |
| `EMBEDDING_PROVIDER`         | `openai`    | `openai` or `ollama`                                              |
| `EMBEDDING_DIMENSIONS`       | `1536`      | Must match your embedding model; changing it means re-indexing    |
| `RETRIEVAL_TOP_K`            | `8`         | Passages sent to the model                                        |
| `RETRIEVAL_MIN_SCORE`        | `0.25`      | Below this the app refuses instead of guessing                    |
| `RERANK_ENABLED`             | `true`      | Rerank candidates before answering                                |
| `ALLOW_PRIVATE_NETWORK_FETCH`| `false`     | SSRF guard for URL ingestion. Leave off in production.            |
| `ALLOW_PUBLIC_REGISTRATION`  | `true`      | Turn off to make the instance admin-invite only                   |
| `STORAGE_DRIVER`             | `local`     | `local` disk, or `s3` for MinIO, R2, S3, or Supabase Storage      |
| `INGEST_MODE`                | `worker`    | `inline` runs ingestion without a worker; the default on Vercel   |
| `DATABASE_POOLER`            | `false`     | `true` for a transaction-mode pooler such as Supabase port 6543   |
| `WIDGET_VISITOR_HOURLY_LIMIT`| `30`        | Questions one website visitor may ask per hour                    |
| `WIDGET_DAILY_LIMIT`         | `1000`      | Questions one widget may answer per day, across all visitors      |

---

## Architecture

| Layer     | Choice                                        | Why                                                      |
| --------- | --------------------------------------------- | -------------------------------------------------------- |
| Web + API | Next.js 15 App Router, TypeScript             | One codebase, one deploy target, streaming built in       |
| Database  | Postgres 16 with pgvector                     | Vectors, full-text, and relational data in one place      |
| Storage   | Local disk, or any S3-compatible store        | Self-hosting shouldn't require a cloud account            |
| Worker    | Postgres job queue, or inline on serverless   | No Redis, and ingestion survives restarts                 |
| Auth      | Server-side sessions, bcrypt, httpOnly cookies| Auditable, with no third-party identity provider          |
| LLM       | Adapters for Anthropic, OpenAI, Groq, Ollama  | Swap providers with one environment variable              |
| Widget    | One vanilla JS file in a shadow DOM           | No framework on your site, and no CSS clashes either way  |

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
- [x] Embeddable website widget with an unanswered-questions report
- [x] Groq provider
- [x] Vercel + Supabase deployment without a worker
- [x] Answers in the language of the question

**Next**

- [ ] Evaluation harness with a public benchmark set
- [ ] Team collections and shared documents
- [ ] OCR for scanned PDFs
- [ ] Headless-browser fallback for JavaScript-rendered pages
- [ ] Password reset and email invitations
- [ ] Keyword search in languages other than English (semantic search already works across languages)
- [ ] Widget hand-off: collect a visitor's email when the answer isn't in the documents

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

If you install a website widget, its visitors can read passages from the documents in that widget's
scope, because that is what a citation shows. Scope public widgets to public documents.

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
<summary><b>Can I put it on my website for customers?</b></summary>

Yes. Create a widget on the **Website widget** page and paste the one-line snippet into your site. See
[Add it to your website](#add-it-to-your-website). It suits FAQ and policy questions for hotels,
clinics, shops, schools, and support teams: anywhere the answers already exist in documents.

</details>

<details>
<summary><b>Does it work in languages other than English?</b></summary>

Answers come back in the language of the question, even when the documents are in another one, and
semantic search matches across languages with a multilingual embedding model such as OpenAI's.
Keyword search still uses English stemming, so exact-term matching is strongest for English
documents.

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

**Keywords:** open source chat with your documents · self-hosted document Q&A · chat with PDF · AI document assistant · RAG chatbot with citations · document AI for teams · private LLM · Ollama RAG · pgvector RAG · Next.js RAG application · AnythingLLM alternative · multi-user document chat · on-premise AI knowledge base · ask questions about your PDFs · embeddable website chat widget · FAQ chatbot for websites · Groq RAG · Supabase pgvector · deploy RAG on Vercel

If this is useful, a ⭐ helps other people find it.

</div>
