import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import { CLASSIFY_MODEL, openai } from "./openai";

// Bump when the prompt changes; eval results in evals/results/ are keyed on this.
export const PROMPT_VERSION = "v1";

export const CLASSIFY_BATCH_SIZE = 15;
export const CLASSIFY_CONCURRENCY = 5;

export interface ClassifiableThread {
  id: string;
  sender: string | null;
  subject: string | null;
  snippet: string | null;
  date: string | null;
  /** Extra per-thread context, used by the consistency review pass. */
  note?: string;
}

export interface BucketCriteria {
  name: string;
  description: string | null;
}

export interface Classification {
  id: string;
  bucket: string;
  confidence: number;
  reason: string;
}

/** A thread the user manually re-filed; fed to the prompt as ground truth. */
export interface CorrectionExample {
  sender: string | null;
  subject: string | null;
  snippet: string | null;
  bucket: string;
}

/** How many recent corrections ride along in the prompt. */
export const CORRECTION_EXAMPLE_LIMIT = 15;

function correctionLines(corrections: CorrectionExample[]): string {
  if (corrections.length === 0) return "";
  const lines = corrections
    .map(
      (c) =>
        `- From: ${c.sender ?? "?"} | Subject: ${c.subject ?? "(none)"} | ${(c.snippet ?? "").slice(0, 120)} → ${c.bucket}`,
    )
    .join("\n");
  return `

The user has manually re-filed these threads. Treat them as authoritative examples of this user's preferences — when a new thread closely resembles one of these, follow the user's placement:
${lines}`;
}

function buildSystemPrompt(
  bucketList: BucketCriteria[],
  corrections: CorrectionExample[],
): string {
  const bucketLines = bucketList
    .map((b) => `- ${b.name}: ${b.description ?? "(no description)"}`)
    .join("\n");
  return `You are an email triage assistant. Assign each input thread to exactly one bucket.

Buckets:
${bucketLines}${correctionLines(corrections)}

Decision rules:
- You see only sender, subject, snippet, and date — never the full body. Judge from those signals.
- Sender relationship dominates: a real person writing to the user directly outranks any automated or list sender.
- List mail (unsubscribe language, marketing tone, no-reply senders) is not Important unless it carries a personal, time-sensitive obligation (interview, bill due, security alert).
- Urgency cues: explicit deadlines, "action required", interviews, offers, payments due.
- Error costs are asymmetric: putting a thread in a higher-attention bucket than needed is a minor annoyance; burying real mail in Auto-Archive is catastrophic (a missed job offer). When uncertain between two buckets, choose the higher-attention one. Only assign Auto-Archive when you are highly confident the thread is worthless.
- confidence: your 0-1 estimate that the assignment is correct.
- reason: one short phrase (under 12 words) naming the deciding signal.
- If a thread has a "note" with context from similar threads, weigh it, but the thread's own content decides.

Return exactly one result per input thread, echoing its id. The bucket field must be exactly one of the bucket names listed above.`;
}

export async function classifyBatch(
  batch: ClassifiableThread[],
  bucketList: BucketCriteria[],
  corrections: CorrectionExample[] = [],
  isRetry = false,
): Promise<Classification[]> {
  if (batch.length === 0) return [];
  const names = bucketList.map((b) => b.name);
  const schema = z.object({
    results: z.array(
      z.object({
        id: z.string(),
        bucket: z.enum(names as [string, ...string[]]),
        confidence: z.number(),
        reason: z.string(),
      }),
    ),
  });
  const completion = await openai.chat.completions.parse({
    model: CLASSIFY_MODEL,
    // Temperature 0: repeatable on camera and in evals.
    temperature: 0,
    response_format: zodResponseFormat(schema, "classification"),
    messages: [
      { role: "system", content: buildSystemPrompt(bucketList, corrections) },
      { role: "user", content: JSON.stringify(batch) },
    ],
  });
  const parsed = completion.choices[0]?.message.parsed;
  if (!parsed) throw new Error("Classification returned no parsed output");
  // Guard against id-echo errors. Ids outside the input set are hallucinated.
  // An id appearing twice means the model stamped some other thread's verdict
  // with this id (observed in practice: a Steam promo judged under a Sequoia
  // thread's id, sending real mail to Auto-Archive) — none of its occurrences
  // can be trusted, so drop them all and let the retry resend those threads.
  const inputIds = new Set(batch.map((t) => t.id));
  const idCounts = new Map<string, number>();
  for (const r of parsed.results) {
    if (inputIds.has(r.id)) idCounts.set(r.id, (idCounts.get(r.id) ?? 0) + 1);
  }
  const results = parsed.results
    .filter((r) => idCounts.get(r.id) === 1)
    .map((r) => ({
      ...r,
      confidence: Math.max(0, Math.min(1, r.confidence)),
    }));
  // The model occasionally drops an id from a batch (~1/200 threads); resend
  // just the missing ones once rather than leaving them unclassified.
  if (!isRetry && results.length < batch.length) {
    const returned = new Set(results.map((r) => r.id));
    const missing = batch.filter((t) => !returned.has(t.id));
    results.push(...(await classifyBatch(missing, bucketList, corrections, true)));
  }
  return results;
}

export interface BucketFitDecision {
  id: string;
  move: boolean;
  confidence: number;
  reason: string;
}

/**
 * Incremental recategorization for a newly created bucket: candidates only,
 * binary decision — move to the new bucket, or stay put. Everything else in
 * the mailbox is untouched.
 */
export async function evaluateBucketFit(
  batch: (ClassifiableThread & { currentBucket: string })[],
  newBucket: BucketCriteria,
  allBuckets: BucketCriteria[],
  isRetry = false,
): Promise<BucketFitDecision[]> {
  if (batch.length === 0) return [];
  const schema = z.object({
    results: z.array(
      z.object({
        id: z.string(),
        move: z.boolean(),
        confidence: z.number(),
        reason: z.string(),
      }),
    ),
  });
  const bucketLines = allBuckets
    .map((b) => `- ${b.name}: ${b.description ?? "(no description)"}`)
    .join("\n");
  const system = `You are an email triage assistant. The user just created a new bucket:

"${newBucket.name}": ${newBucket.description ?? "(no description)"}

Their full bucket list is now:
${bucketLines}

For each input thread (each includes its current bucket as "currentBucket"), decide whether it belongs in the new bucket ("move": true) or should stay where it is ("move": false). Only move a thread when it fits the new bucket clearly better than its current one — when in doubt, leave it. You see only sender, subject, snippet, and date. confidence is your 0-1 estimate; reason is one short phrase. Return exactly one result per input thread, echoing its id.`;
  const completion = await openai.chat.completions.parse({
    model: CLASSIFY_MODEL,
    temperature: 0,
    response_format: zodResponseFormat(schema, "bucket_fit"),
    messages: [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(batch) },
    ],
  });
  const parsed = completion.choices[0]?.message.parsed;
  if (!parsed) throw new Error("Bucket fit returned no parsed output");
  // Same id-echo guard as classifyBatch: duplicated ids mean a verdict got
  // stamped with the wrong thread's id — here that would move the wrong
  // thread into the new bucket. Drop and resend.
  const inputIds = new Set(batch.map((t) => t.id));
  const idCounts = new Map<string, number>();
  for (const r of parsed.results) {
    if (inputIds.has(r.id)) idCounts.set(r.id, (idCounts.get(r.id) ?? 0) + 1);
  }
  const results = parsed.results
    .filter((r) => idCounts.get(r.id) === 1)
    .map((r) => ({ ...r, confidence: Math.max(0, Math.min(1, r.confidence)) }));
  if (!isRetry && results.length < batch.length) {
    const returned = new Set(results.map((r) => r.id));
    const missing = batch.filter((t) => !returned.has(t.id));
    results.push(...(await evaluateBucketFit(missing, newBucket, allBuckets, true)));
  }
  return results;
}

export interface ClusterSample {
  clusterIndex: number;
  size: number;
  examples: { sender: string | null; subject: string | null; snippet: string | null }[];
}

export interface BucketSuggestion {
  clusterIndex: number;
  name: string;
  description: string;
}

/**
 * Bucket discovery: shown embedding-cluster samples from the user's mailbox,
 * propose only the new buckets genuinely worth having. Clustering is free
 * (the vectors already exist); the LLM spends judgment once per suggestion
 * pass, not per thread.
 */
export async function suggestBuckets(
  clusters: ClusterSample[],
  existingBuckets: BucketCriteria[],
): Promise<BucketSuggestion[]> {
  if (clusters.length === 0) return [];
  const schema = z.object({
    results: z.array(
      z.object({
        clusterIndex: z.number(),
        propose: z.boolean(),
        name: z.string(),
        description: z.string(),
      }),
    ),
  });
  const bucketLines = existingBuckets
    .map((b) => `- ${b.name}: ${b.description ?? "(no description)"}`)
    .join("\n");
  const system = `You are helping a user organize their email. Their threads were clustered by content similarity; you are shown a sample from each cluster.

Their existing buckets:
${bucketLines}

For each cluster, decide whether it deserves a NEW bucket ("propose": true) or is already well-served by an existing bucket ("propose": false). Only propose buckets a user would plausibly create themselves: coherent, recognizable themes like "Job Search" or "Travel", never vague ones like "Misc" or restatements of existing buckets. name: at most three words. description: one sentence of classification criteria, written the way the user would describe what belongs there. Return one result per cluster, echoing its clusterIndex.`;
  const completion = await openai.chat.completions.parse({
    model: CLASSIFY_MODEL,
    temperature: 0,
    response_format: zodResponseFormat(schema, "bucket_suggestions"),
    messages: [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(clusters) },
    ],
  });
  const parsed = completion.choices[0]?.message.parsed;
  if (!parsed) throw new Error("Bucket suggestion returned no parsed output");
  const existingNames = new Set(existingBuckets.map((b) => b.name.toLowerCase()));
  const seen = new Set<string>();
  return parsed.results
    .filter((r) => r.propose && r.name.trim())
    .filter((r) => {
      const key = r.name.trim().toLowerCase();
      if (existingNames.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((r) => ({
      clusterIndex: r.clusterIndex,
      name: r.name.trim(),
      description: r.description.trim(),
    }));
}

/** A thread offered to the search-answer LLM stage. Metadata only. */
export interface SearchCandidate extends ClassifiableThread {
  /** Current bucket name, given to the model as context for its answer. */
  bucket?: string | null;
}

export interface SearchMatch {
  id: string;
  reason: string;
}

export interface InboxAnswer {
  /** One or two sentences answering the query in plain language. */
  answer: string;
  /** Candidates the model judged genuinely relevant, in similarity order. */
  matches: SearchMatch[];
}

/**
 * Semantic inbox search, stage two (LLM judgment). Given the query and the
 * similarity-retrieved candidates, decide which genuinely match and write a
 * short natural-language answer. Retrieval casts a wide net, so the model is
 * told to be strict — most candidates are near-misses.
 */
export async function answerInboxQuery(
  query: string,
  candidates: SearchCandidate[],
): Promise<InboxAnswer> {
  if (candidates.length === 0) return { answer: "", matches: [] };
  const schema = z.object({
    answer: z.string(),
    results: z.array(
      z.object({
        id: z.string(),
        relevant: z.boolean(),
        reason: z.string(),
      }),
    ),
  });
  const system = `You are an email triage assistant helping the user find threads in their inbox by answering a natural-language question.

You are given the user's question and a set of candidate threads already narrowed by similarity search. You see only sender, subject, snippet, date, and current bucket — never the full body.

For each candidate, decide whether it genuinely matches the user's question ("relevant": true or false). Be strict: similarity search casts a wide net, so many candidates are near-misses that do not actually match — exclude those. reason: one short phrase (under 12 words) naming why it matches.

Also write "answer": one or two plain-language sentences addressing the question directly, grounded in what you found (how many, which senders, the most relevant thread). If nothing matches, say so briefly.

Return exactly one result per candidate, echoing its id.`;
  const completion = await openai.chat.completions.parse({
    model: CLASSIFY_MODEL,
    // Temperature 0: repeatable on camera, same as every other LLM call here.
    temperature: 0,
    response_format: zodResponseFormat(schema, "inbox_search"),
    messages: [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify({ question: query, candidates }) },
    ],
  });
  const parsed = completion.choices[0]?.message.parsed;
  if (!parsed) throw new Error("Inbox search returned no parsed output");
  // Same id-echo guard as classifyBatch: ids outside the input set are
  // hallucinated, and a duplicated id means a verdict was stamped with the
  // wrong thread's id — drop all its occurrences. Here a dropped id just
  // fails to surface as a match (a soft miss), never a misfile, so there is
  // no retry: an unreturned candidate is simply treated as not relevant.
  const inputIds = new Set(candidates.map((c) => c.id));
  const idCounts = new Map<string, number>();
  for (const r of parsed.results) {
    if (inputIds.has(r.id)) idCounts.set(r.id, (idCounts.get(r.id) ?? 0) + 1);
  }
  const reasonById = new Map<string, string>();
  for (const r of parsed.results) {
    if (r.relevant && idCounts.get(r.id) === 1) reasonById.set(r.id, r.reason);
  }
  // Preserve similarity order by walking the candidates, not the model output.
  const matches = candidates
    .filter((c) => reasonById.has(c.id))
    .map((c) => ({ id: c.id, reason: reasonById.get(c.id)! }));
  return { answer: parsed.answer, matches };
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
