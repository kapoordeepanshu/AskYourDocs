# Contributing to AskYourDocs

Thanks for taking a look. This project has one unusual priority, and it shapes how contributions are
reviewed: **an answer that cites a source which does not support it is a bug, not a rough edge.**
Changes that improve grounding, retrieval quality, or citation accuracy get the most attention.

## Getting set up

```bash
git clone https://github.com/kapoordeepanshu/AskYourDocs.git
cd AskYourDocs
cp .env.example .env          # set SESSION_SECRET and a provider
npm install
docker compose up postgres -d # just the database
npm run db:migrate
npm run dev                   # app on :3000
npm run worker:dev            # ingestion worker, in a second terminal
```

You do not need a paid API key to develop. Set `LLM_PROVIDER=ollama` and `EMBEDDING_PROVIDER=ollama`,
run `ollama serve`, and pull `llama3.1:8b` and `nomic-embed-text`. Remember to set
`EMBEDDING_DIMENSIONS=768` to match.

## Before opening a pull request

```bash
npm run typecheck
npm test
npm run build
```

## What makes a good bug report

For a wrong or ungrounded answer, please include:

1. The question you asked
2. The document, or a small excerpt that reproduces it
3. The answer, and the citation that did not hold up
4. Your `LLM_PROVIDER`, model, and `EMBEDDING_PROVIDER`

That last category is the most valuable report this project can receive. If the excerpt is
shareable, consider adding it to the evaluation set under `tests/eval/` so the case is protected
against regressions.

## Code conventions

- TypeScript everywhere, `strict` on. No `any` without a comment explaining why.
- Comments explain **why**, not what. Skip a comment that restates the line below it.
- Every retrieval query filters by `owner_id` **in the SQL**. Never filter results in application code
  after the fact — that is the difference between isolation and a leak waiting to happen.
- No new runtime dependency without a note in the pull request on what it replaces and why hand-writing
  it would be worse.
- Database changes go through `npm run db:generate`. Hand-written SQL belongs in `drizzle/custom/`.

## Changing the embedding model

`EMBEDDING_DIMENSIONS` is baked into the `chunks.embedding` column, so changing the model means a
migration plus a full re-index. If your change touches embeddings, say so explicitly in the pull
request description.

## Scope

Kept deliberately narrow: a self-hosted, multi-user document assistant with trustworthy citations.
Requests for agent frameworks, general-purpose chat, or a plugin marketplace are likely to be
declined — not because they are bad ideas, but because other projects already do them well.

## License

Contributions are accepted under the [Apache 2.0](LICENSE) license.
