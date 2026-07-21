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

function buildSystemPrompt(bucketList: BucketCriteria[]): string {
  const bucketLines = bucketList
    .map((b) => `- ${b.name}: ${b.description ?? "(no description)"}`)
    .join("\n");
  return `You are an email triage assistant. Assign each input thread to exactly one bucket.

Buckets:
${bucketLines}

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
      { role: "system", content: buildSystemPrompt(bucketList) },
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
    results.push(...(await classifyBatch(missing, bucketList, true)));
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
  const inputIds = new Set(batch.map((t) => t.id));
  return parsed.results
    .filter((r) => inputIds.has(r.id))
    .map((r) => ({ ...r, confidence: Math.max(0, Math.min(1, r.confidence)) }));
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
