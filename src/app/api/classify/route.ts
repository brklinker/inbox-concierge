import { auth } from "@/auth";
import { db } from "@/db";
import { buckets, threads } from "@/db/schema";
import {
  CLASSIFY_BATCH_SIZE,
  CLASSIFY_CONCURRENCY,
  chunk,
  classifyBatch,
  type ClassifiableThread,
} from "@/lib/classify";
import { embedTexts, embeddingInput } from "@/lib/openai";
import { neighborConsensus, topK } from "@/lib/similarity";
import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import pLimit from "p-limit";
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

const CONSISTENCY_NEIGHBORS = 10;
const CONSISTENCY_DISAGREEMENT = 0.6;
const CONSISTENCY_CONFIDENCE = 0.7;

interface StreamedResult {
  id: string;
  bucketId: string | null;
  bucket: string | null;
  confidence: number;
  reason: string;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email || session.error) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userEmail = session.user.email;
  const body = (await req.json().catch(() => ({}))) as {
    threadIds?: string[];
    force?: boolean;
  };

  const bucketRows = await db
    .select()
    .from(buckets)
    .where(eq(buckets.userEmail, userEmail))
    .orderBy(asc(buckets.position));
  if (bucketRows.length === 0) {
    return Response.json({ error: "No buckets" }, { status: 400 });
  }
  const bucketByName = new Map(bucketRows.map((b) => [b.name.toLowerCase(), b]));
  const bucketById = new Map(bucketRows.map((b) => [b.id, b]));
  const criteria = bucketRows.map((b) => ({ name: b.name, description: b.description }));

  const targetFilter = body.threadIds?.length
    ? and(
        eq(threads.userEmail, userEmail),
        inArray(threads.id, body.threadIds),
        ...(body.force ? [] : [isNull(threads.classifiedAt)]),
      )
    : and(eq(threads.userEmail, userEmail), isNull(threads.classifiedAt));
  const targets = await db.select().from(threads).where(targetFilter);

  const encoder = new TextEncoder();
  // If the client disconnects mid-run, enqueue() starts throwing. The work
  // itself should finish (DB writes make the run durable; a reload picks the
  // results up), so sends become no-ops instead of killing the pipeline.
  let clientGone = false;
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: object) => {
        if (clientGone) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          clientGone = true;
        }
      };

      try {
        const batches = chunk(targets, CLASSIFY_BATCH_SIZE);
        send({
          type: "start",
          total: targets.length,
          batches: batches.length,
        });

        // Embeddings run concurrently with classification; both must finish
        // before the consistency pass, which needs labels AND vectors.
        const embedTask = (async () => {
          const missing = targets.filter((t) => !t.embedding);
          if (missing.length === 0) return;
          const vectors = await embedTexts(missing.map(embeddingInput));
          const limit = pLimit(10);
          await Promise.all(
            missing.map((t, i) =>
              limit(() =>
                db
                  .update(threads)
                  .set({ embedding: vectors[i] })
                  .where(
                    and(eq(threads.id, t.id), eq(threads.userEmail, userEmail)),
                  ),
              ),
            ),
          );
        })();

        const limit = pLimit(CLASSIFY_CONCURRENCY);
        let completed = 0;
        const classifyTask = Promise.all(
          batches.map((batch, batchIndex) =>
            limit(async () => {
              const inputs: ClassifiableThread[] = batch.map((t) => ({
                id: t.id,
                sender: t.sender,
                subject: t.subject,
                snippet: t.snippet,
                date: t.internalDate?.toISOString() ?? null,
              }));
              const results = await classifyBatch(inputs, criteria);
              const now = new Date();
              const writeLimit = pLimit(10);
              const streamed: StreamedResult[] = [];
              await Promise.all(
                results.map((r) =>
                  writeLimit(async () => {
                    const bucket = bucketByName.get(r.bucket.toLowerCase());
                    if (!bucket) return;
                    await db
                      .update(threads)
                      .set({
                        bucketId: bucket.id,
                        confidence: r.confidence,
                        reason: r.reason,
                        classifiedAt: now,
                      })
                      .where(
                        and(eq(threads.id, r.id), eq(threads.userEmail, userEmail)),
                      );
                    streamed.push({
                      id: r.id,
                      bucketId: bucket.id,
                      bucket: bucket.name,
                      confidence: r.confidence,
                      reason: r.reason,
                    });
                  }),
                ),
              );
              completed += 1;
              send({
                type: "batch",
                batchIndex,
                completed,
                batches: batches.length,
                results: streamed,
              });
            }),
          ),
        );

        await Promise.all([embedTask, classifyTask]);

        // Consistency pass: flag threads whose nearest neighbors mostly
        // disagree with their label and whose own confidence is low.
        const pool = await db
          .select({
            id: threads.id,
            embedding: threads.embedding,
            bucketId: threads.bucketId,
            confidence: threads.confidence,
            sender: threads.sender,
            subject: threads.subject,
            snippet: threads.snippet,
            internalDate: threads.internalDate,
          })
          .from(threads)
          .where(
            and(
              eq(threads.userEmail, userEmail),
              isNotNull(threads.embedding),
              isNotNull(threads.bucketId),
            ),
          );
        const poolVectors = pool.map((p) => ({
          id: p.id,
          embedding: p.embedding!,
        }));
        const poolById = new Map(pool.map((p) => [p.id, p]));
        const targetIds = new Set(targets.map((t) => t.id));

        const flagged: { thread: (typeof pool)[number]; majority: string }[] = [];
        for (const t of pool) {
          if (!targetIds.has(t.id)) continue;
          if ((t.confidence ?? 1) >= CONSISTENCY_CONFIDENCE) continue;
          const label = bucketById.get(t.bucketId!)?.name;
          if (!label) continue;
          const neighbors = topK(
            t.embedding!,
            poolVectors,
            CONSISTENCY_NEIGHBORS,
            t.id,
          );
          const neighborLabels = neighbors
            .map((n) => {
              const nb = poolById.get(n.id);
              return nb?.bucketId ? bucketById.get(nb.bucketId)?.name : undefined;
            })
            .filter((l): l is string => !!l);
          const { majority, disagreement } = neighborConsensus(neighborLabels, label);
          if (disagreement > CONSISTENCY_DISAGREEMENT && majority && majority !== label) {
            flagged.push({ thread: t, majority });
          }
        }

        send({ type: "review_start", flagged: flagged.length });

        const corrected: (StreamedResult & { previousBucket: string })[] = [];
        if (flagged.length > 0) {
          const reviewInputs: ClassifiableThread[] = flagged.map((f) => ({
            id: f.thread.id,
            sender: f.thread.sender,
            subject: f.thread.subject,
            snippet: f.thread.snippet,
            date: f.thread.internalDate?.toISOString() ?? null,
            note: `Similar threads were mostly classified as "${f.majority}"; this one is currently "${bucketById.get(f.thread.bucketId!)?.name}". Confirm or correct.`,
          }));
          for (const reviewBatch of chunk(reviewInputs, CLASSIFY_BATCH_SIZE)) {
            const results = await classifyBatch(reviewBatch, criteria);
            for (const r of results) {
              const bucket = bucketByName.get(r.bucket.toLowerCase());
              const prev = poolById.get(r.id);
              if (!bucket || !prev || bucket.id === prev.bucketId) continue;
              await db
                .update(threads)
                .set({
                  bucketId: bucket.id,
                  confidence: r.confidence,
                  reason: r.reason,
                  classifiedAt: new Date(),
                })
                .where(
                  and(eq(threads.id, r.id), eq(threads.userEmail, userEmail)),
                );
              corrected.push({
                id: r.id,
                bucketId: bucket.id,
                bucket: bucket.name,
                confidence: r.confidence,
                reason: r.reason,
                previousBucket: bucketById.get(prev.bucketId!)?.name ?? "?",
              });
            }
          }
        }

        send({
          type: "done",
          classified: targets.length,
          reviewed: flagged.length,
          corrections: corrected,
        });
      } catch (e) {
        send({
          type: "error",
          message: e instanceof Error ? e.message : String(e),
        });
      } finally {
        if (!clientGone) {
          try {
            controller.close();
          } catch {
            // Already closed/errored; nothing to do.
          }
        }
      }
    },
    cancel() {
      clientGone = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
