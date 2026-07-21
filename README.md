# Inbox Concierge

Sign in with Google and your last 200 inbox threads get sorted into buckets —
Important, Can Wait, Newsletter, Notifications, Auto-Archive — plus any bucket
you define in plain English ("Job Applications: recruiter outreach, interview
scheduling…"). New buckets take effect in seconds, retroactively, without
reclassifying the whole mailbox.

## Architecture

The LLM is the classifier of record; embeddings are the cheap similarity
substrate that keeps classification maintainable (a cascade: cheap retrieval
stage, expensive judgment stage).

```mermaid
flowchart LR
    A[Gmail API<br/>threads.list + threads.get<br/>metadata only] --> B[(Neon Postgres<br/>+ pgvector)]
    B --> C[Classifier<br/>gpt-4o-mini, batches of 15<br/>structured outputs, temp 0]
    B --> D[Embeddings<br/>text-embedding-3-small]
    C -->|SSE, one event per batch| E[UI: live bucket sorting]
    D --> F[Consistency check<br/>10-NN disagreement + low confidence<br/>→ one LLM review batch]
    F --> E
    D --> G[Custom bucket creation<br/>top-k candidates only → LLM<br/>"scanned 200, evaluated 34, moved 12"]
    G --> E
```

Embeddings do three jobs:

1. **Consistency checking** — after classification, threads whose 10 nearest
   neighbors mostly disagree with their label (and whose own confidence is low)
   go back to the LLM in one review batch. The UI shows "N threads
   auto-reviewed".
2. **Incremental recategorization** — creating a bucket embeds its name +
   description, retrieves the top-k similar threads, and sends only those
   candidates to the LLM. Everything else is untouched.
3. **The scaling story** — per-user brute-force cosine works to ~100k threads;
   pgvector HNSW after that; a dedicated vector DB probably never, for this
   workload.

Classification costs are asymmetric and the prompt says so: misclassifying
toward Important is a minor annoyance; burying real mail in Auto-Archive is a
missed job offer. When uncertain, the model is instructed to pick the
higher-attention bucket.

**Why there's a read view at all** (the brief didn't require one): you can't
judge a triage system without reading what it triaged — the read view is how
a silently misfiled thread was caught during development — and re-filing a
thread is only an informed decision after reading it. It exists to serve the
correction loop, and it fetches bodies on demand without ever storing them.

**Corrections are a feedback loop.** Re-file a thread from its read view and
the placement becomes human truth: it is never reclassified, auto-reviewed, or
auto-moved again, and the most recent corrections ride along in every future
classification prompt as authoritative examples of your preferences.
Corrections are kept separate from the eval gold set — they're made after
seeing model output, which is exactly the anchoring the gold set must avoid.

## How I know it works

`npm run eval` runs the production classification code path against a
hand-labeled gold set (threads labeled at the hidden `/label` route,
keyboard-first, in random order) and prints overall accuracy, per-bucket
precision/recall, a confusion matrix, and every miss. Catastrophic misses
(gold-Important predicted Auto-Archive) are tracked as their own number with a
target of zero. Prompt iterations are recorded in `evals/NOTES.md` with raw
results committed under `evals/results/`.

LLM self-reported confidence is treated as an ordinal routing signal
(low/medium/high), never as a probability — it's poorly calibrated, and the
consistency check uses it only as a tiebreaker for which threads deserve a
second look.

## Isn't this just Gmail's tabs?

Gmail's Primary/Promotions/Updates categories are fixed and Google-defined.
These buckets are user-defined in natural language, and they apply
retroactively over existing mail in seconds.

## Stack

- Next.js (App Router) + TypeScript on Vercel
- Auth.js (NextAuth v5) — Google OAuth **is** the Gmail access (`gmail.readonly`,
  offline access, refresh-token rotation in the JWT callback)
- Neon Postgres + pgvector, Drizzle ORM
- OpenAI: `gpt-4o-mini` for classification (structured outputs, temperature 0),
  `text-embedding-3-small` (1536-dim). One provider deliberately — the eval
  harness is the tripwire if that choice was wrong.
- SSE from a single route handler for live classification progress — no
  websockets, no event infrastructure

## Run locally

```bash
npm install
cp .env.example .env.local   # fill in the values (see comments in the file)
npm run db:migrate           # creates tables + enables pgvector
npm run dev
```

### Google OAuth note (test users)

`gmail.readonly` is a restricted scope, so the app runs in **testing mode** on
the OAuth consent screen. Google only allows manually added test users to sign
in. Send me any email address and I'll add it as a test user within the hour.

## Privacy

What gets stored: subjects, senders, and Gmail's ~100-character preview
snippets — never full message bodies. Classification and embeddings only ever
see that metadata. Opening a thread in the read view fetches its full messages
from Gmail on demand, renders them in a sandboxed frame, and writes nothing to
the database. Where: a Neon Postgres instance. Gmail access is read-only. I'll
delete any reviewer's data on request.

## Eval

```bash
npm run eval            # runs the gold set through the live prompt, writes evals/results/
npm run eval -- --dry   # print only
```
