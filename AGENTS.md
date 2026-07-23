<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Agent guide — Inbox Concierge

Gmail inbox triage: signs in with Google (read-only), classifies the last 200
inbox threads into user-defined buckets with gpt-4o-mini, and uses embeddings
for consistency checking, incremental recategorization, and bucket discovery.
Next.js App Router + TypeScript, Neon Postgres + pgvector via Drizzle,
Auth.js v5, OpenAI. Full architecture rationale is in README.md; eval history
in evals/NOTES.md.

## Commands

```bash
npm run dev          # dev server (needs .env.local — see .env.example)
npm test             # vitest; must pass before any commit
npm run lint         # eslint
npx tsc --noEmit     # typecheck
npm run build        # production build (works without env — clients are lazy)
npm run eval         # gold-set eval; writes evals/results/<date>-<version>.txt
npm run db:generate  # drizzle-kit migration from schema.ts
npm run db:migrate   # apply migrations to Neon
```

CI (.github/workflows/ci.yml) runs lint → typecheck → test → build on push.

## Map

- `src/lib/classify.ts` — prompt (PROMPT_VERSION), classifyBatch,
  evaluateBucketFit, suggestBuckets, answerInboxQuery; all LLM entry points
  live here
- `src/lib/consistency.ts`, `candidates.ts`, `cluster.ts`, `similarity.ts`,
  `search.ts` — pure embedding-side logic (unit-tested)
- `src/lib/gmail.ts` — REST client; `html-entities.ts` — RFC 2047 / entity
  decoding; `corrections.ts` — few-shot correction fetch
- `src/lib/rate-limit.ts` — per-user sliding window on LLM routes;
  `classify-lock.ts` — DB lease, one classify run per user
- `src/app/api/*` — thin route handlers; classify streams SSE; search is
  the ask-your-inbox retrieval→LLM endpoint
- `src/components/inbox/*` — UI; design tokens in `src/app/globals.css`
  ("Broadsheet" system — paper/ink/press-cyan/magenta, Source Serif 4)
- `scripts/eval.ts` — same classifyBatch code path as production
- `/label` — hidden developer route for blind gold labels

## Invariants (do not break)

1. **Human placement wins.** A thread with `corrected_at` set is never
   reclassified, auto-reviewed, or auto-moved by any code path — force
   included. Only deleting its bucket clears it.
2. **Metadata only.** Classification and storage see subject/sender/snippet.
   Nothing may fetch or store message bodies (`format=metadata` only) — the
   README's privacy claim depends on this.
3. **Guard LLM batch outputs.** Ids outside the input set are dropped;
   duplicated ids are poisoned (drop all, retry once). Any new batched LLM
   call needs the same guard — an id swap silently misfiled real mail once.
4. **Eval integrity.** Gold labels are blind ground truth labeled at /label;
   corrections are anchored feedback — never conflate them. A gold thread's
   own correction must not appear in its eval prompt.
5. **Prompt changes**: bump `PROMPT_VERSION`, run `npm run eval`, add a dated
   entry to evals/NOTES.md. Misses caused by personal preference get a
   bucket-description fix, not a prompt fix.
6. **Determinism**: temperature 0 on every LLM call; kmeans is seeded
   deterministically (no Math.random in the suggest path).
7. **Per-user scoping**: every thread/bucket query and write filters by
   `user_email`.

## Gotchas

- `db` and `openai` exports are lazy Proxies so `next build` runs without
  env; don't convert them to eager construction.
- Env lives in `.env.local` (gitignored); `.env.example` documents the keys.
- Scripts run via `tsx` and use CJS mode — no top-level await; wrap in
  `main()`.
- OAuth is in Google testing mode (restricted gmail.readonly scope): only
  listed test users can sign in.
- Commit style: incremental, decision-narrating messages — the history is
  part of the take-home submission.
