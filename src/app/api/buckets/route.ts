import { auth } from "@/auth";
import { db } from "@/db";
import { buckets, threads } from "@/db/schema";
import {
  CLASSIFY_BATCH_SIZE,
  CLASSIFY_CONCURRENCY,
  chunk,
  evaluateBucketFit,
} from "@/lib/classify";
import { embedTexts } from "@/lib/openai";
import { toApiBucket } from "@/lib/serialize";
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import pLimit from "p-limit";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

// Candidate retrieval: top-k threads by similarity to the bucket embedding,
// plus anything the classifier was unsure about.
const CANDIDATE_K = 40;
const CANDIDATE_CONFIDENCE = 0.6;
// Vague bucket names ("Misc") retrieve nothing meaningful; if even the best
// match is this weak, fall back to evaluating every thread.
const SIMILARITY_FLOOR = 0.25;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email || session.error) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userEmail = session.user.email;
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    description?: string;
  };
  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  const description = body.description?.trim() || null;

  const existing = await db
    .select()
    .from(buckets)
    .where(eq(buckets.userEmail, userEmail))
    .orderBy(asc(buckets.position));
  if (existing.some((b) => b.name.toLowerCase() === name.toLowerCase())) {
    return NextResponse.json({ error: "Bucket already exists" }, { status: 409 });
  }

  const [bucketEmbedding] = await embedTexts([
    `${name}. ${description ?? ""}`.trim(),
  ]);
  const [bucket] = await db
    .insert(buckets)
    .values({
      userEmail,
      name,
      description,
      isDefault: false,
      embedding: bucketEmbedding,
      position: (existing.at(-1)?.position ?? -1) + 1,
    })
    .returning();

  const pool = await db
    .select()
    .from(threads)
    .where(and(eq(threads.userEmail, userEmail), isNotNull(threads.embedding)));
  const scanned = pool.length;

  // Rank every thread against the bucket embedding (embeddings are unit-norm,
  // dot product == cosine).
  const ranked = pool
    .map((t) => ({
      thread: t,
      similarity: t.embedding!.reduce(
        (sum, v, i) => sum + v * bucketEmbedding[i],
        0,
      ),
    }))
    .sort((a, b) => b.similarity - a.similarity);

  const weakRetrieval = (ranked[0]?.similarity ?? 0) < SIMILARITY_FLOOR;
  const candidateIds = new Set<string>();
  if (weakRetrieval) {
    for (const r of ranked) candidateIds.add(r.thread.id);
  } else {
    for (const r of ranked.slice(0, CANDIDATE_K)) candidateIds.add(r.thread.id);
    for (const t of pool) {
      if ((t.confidence ?? 0) < CANDIDATE_CONFIDENCE) candidateIds.add(t.id);
    }
  }
  const candidates = pool.filter((t) => candidateIds.has(t.id));

  const bucketNameById = new Map(existing.map((b) => [b.id, b.name]));
  const allCriteria = [...existing, bucket].map((b) => ({
    name: b.name,
    description: b.description,
  }));
  const limit = pLimit(CLASSIFY_CONCURRENCY);
  const decisions = (
    await Promise.all(
      chunk(candidates, CLASSIFY_BATCH_SIZE).map((batch) =>
        limit(() =>
          evaluateBucketFit(
            batch.map((t) => ({
              id: t.id,
              sender: t.sender,
              subject: t.subject,
              snippet: t.snippet,
              date: t.internalDate?.toISOString() ?? null,
              currentBucket: t.bucketId
                ? (bucketNameById.get(t.bucketId) ?? "Unsorted")
                : "Unsorted",
            })),
            { name: bucket.name, description: bucket.description },
            allCriteria,
          ),
        ),
      ),
    )
  ).flat();

  const toMove = decisions.filter((d) => d.move);
  const now = new Date();
  const writeLimit = pLimit(10);
  await Promise.all(
    toMove.map((d) =>
      writeLimit(() =>
        db
          .update(threads)
          .set({
            bucketId: bucket.id,
            confidence: d.confidence,
            reason: d.reason,
            classifiedAt: now,
          })
          .where(eq(threads.id, d.id)),
      ),
    ),
  );

  return NextResponse.json({
    bucket: toApiBucket(bucket),
    scanned,
    evaluated: candidates.length,
    usedFallback: weakRetrieval,
    moved: toMove.map((d) => ({
      id: d.id,
      bucketId: bucket.id,
      confidence: d.confidence,
      reason: d.reason,
    })),
  });
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rows = await db
    .select({
      id: buckets.id,
      name: buckets.name,
      description: buckets.description,
      isDefault: buckets.isDefault,
      position: buckets.position,
      count: sql<number>`(select count(*) from ${threads} where ${threads.bucketId} = ${buckets.id})`,
    })
    .from(buckets)
    .where(eq(buckets.userEmail, session.user.email))
    .orderBy(asc(buckets.position));
  return NextResponse.json({ buckets: rows });
}
