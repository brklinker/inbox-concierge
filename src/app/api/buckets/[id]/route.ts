import { auth } from "@/auth";
import { db } from "@/db";
import { buckets, threads } from "@/db/schema";
import { selectCandidates } from "@/lib/candidates";
import {
  CLASSIFY_BATCH_SIZE,
  CLASSIFY_CONCURRENCY,
  chunk,
  classifyBatch,
  evaluateBucketFit,
} from "@/lib/classify";
import { fetchCorrections } from "@/lib/corrections";
import { embedTexts } from "@/lib/openai";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { toApiBucket } from "@/lib/serialize";
import { and, asc, eq, ne } from "drizzle-orm";
import pLimit from "p-limit";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

async function ownedBucket(id: string, userEmail: string) {
  const [bucket] = await db
    .select()
    .from(buckets)
    .where(and(eq(buckets.id, id), eq(buckets.userEmail, userEmail)));
  return bucket;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.email || session.error) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userEmail = session.user.email;
  const rl = rateLimit(`buckets:${userEmail}`, 20, 10 * 60_000);
  if (!rl.ok) return rateLimitResponse(rl.retryAfterSeconds);
  const { id } = await params;
  const bucket = await ownedBucket(id, userEmail);
  if (!bucket) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    description?: string;
  };
  // Descriptions are the personalization lever (they ARE the classification
  // criteria), so they're editable on every bucket. Names of defaults stay
  // fixed — the eval gold labels and seeded semantics hang off them.
  const name = bucket.isDefault ? bucket.name : (body.name?.trim() || bucket.name);
  const description = body.description?.trim() ?? bucket.description;
  const criteriaChanged =
    name !== bucket.name || (description ?? "") !== (bucket.description ?? "");
  const [embedding] = await embedTexts([`${name}. ${description ?? ""}`.trim()]);
  const [updated] = await db
    .update(buckets)
    .set({ name, description, embedding })
    .where(eq(buckets.id, id))
    .returning();
  if (!criteriaChanged) {
    return NextResponse.json({ bucket: toApiBucket(updated) });
  }

  // Edited criteria re-sort in both directions: candidates near the new
  // meaning are judged for membership, and current members that the new
  // description no longer claims are reclassified out. Hand-placed threads
  // (corrected_at set) are excluded from both.
  const all = await db
    .select()
    .from(buckets)
    .where(eq(buckets.userEmail, userEmail))
    .orderBy(asc(buckets.position));
  const pool = await db
    .select()
    .from(threads)
    .where(eq(threads.userEmail, userEmail));
  const members = pool.filter((t) => t.bucketId === id && !t.correctedAt);
  const outsiders = pool.filter((t) => t.bucketId !== id && t.embedding);
  const { ids: candidateIds, usedFallback } = selectCandidates(
    outsiders.map((t) => ({
      id: t.id,
      embedding: t.embedding!,
      confidence: t.confidence,
      corrected: !!t.correctedAt,
    })),
    embedding,
  );
  const candidates = outsiders.filter((t) => candidateIds.has(t.id));

  const allCriteria = all.map((b) => ({ name: b.name, description: b.description }));
  const bucketNameById = new Map(all.map((b) => [b.id, b.name]));
  const byName = new Map(all.map((b) => [b.name.toLowerCase(), b]));
  const corrections = await fetchCorrections(userEmail);
  const limit = pLimit(CLASSIFY_CONCURRENCY);
  const toInput = (t: (typeof pool)[number]) => ({
    id: t.id,
    sender: t.sender,
    subject: t.subject,
    snippet: t.snippet,
    date: t.internalDate?.toISOString() ?? null,
  });

  const [inDecisions, outResults] = await Promise.all([
    Promise.all(
      chunk(candidates, CLASSIFY_BATCH_SIZE).map((batch) =>
        limit(() =>
          evaluateBucketFit(
            batch.map((t) => ({
              ...toInput(t),
              currentBucket: t.bucketId
                ? (bucketNameById.get(t.bucketId) ?? "Unsorted")
                : "Unsorted",
            })),
            { name: updated.name, description: updated.description },
            allCriteria,
          ),
        ),
      ),
    ).then((r) => r.flat()),
    Promise.all(
      chunk(members, CLASSIFY_BATCH_SIZE).map((batch) =>
        limit(() => classifyBatch(batch.map(toInput), allCriteria, corrections)),
      ),
    ).then((r) => r.flat()),
  ]);

  const now = new Date();
  const moved: { id: string; bucketId: string; confidence: number; reason: string }[] = [];
  const writeLimit = pLimit(10);
  await Promise.all([
    ...inDecisions
      .filter((d) => d.move)
      .map((d) =>
        writeLimit(async () => {
          await db
            .update(threads)
            .set({ bucketId: id, confidence: d.confidence, reason: d.reason, classifiedAt: now })
            .where(and(eq(threads.id, d.id), eq(threads.userEmail, userEmail)));
          moved.push({ id: d.id, bucketId: id, confidence: d.confidence, reason: d.reason });
        }),
      ),
    ...outResults.map((r) =>
      writeLimit(async () => {
        const target = byName.get(r.bucket.toLowerCase());
        if (!target || target.id === id) return;
        await db
          .update(threads)
          .set({
            bucketId: target.id,
            confidence: r.confidence,
            reason: r.reason,
            classifiedAt: now,
          })
          .where(and(eq(threads.id, r.id), eq(threads.userEmail, userEmail)));
        moved.push({ id: r.id, bucketId: target.id, confidence: r.confidence, reason: r.reason });
      }),
    ),
  ]);

  return NextResponse.json({
    bucket: toApiBucket(updated),
    scanned: pool.length,
    evaluated: candidates.length + members.length,
    usedFallback,
    moved,
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.email || session.error) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userEmail = session.user.email;
  const rl = rateLimit(`buckets:${userEmail}`, 20, 10 * 60_000);
  if (!rl.ok) return rateLimitResponse(rl.retryAfterSeconds);
  const { id } = await params;
  const bucket = await ownedBucket(id, userEmail);
  if (!bucket) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const remaining = await db
    .select()
    .from(buckets)
    .where(and(eq(buckets.userEmail, userEmail), ne(buckets.id, id)))
    .orderBy(asc(buckets.position));
  // Zero buckets would leave classification with nothing to sort into — and
  // the seeder would re-create all five defaults on next load, undoing the
  // delete anyway.
  if (remaining.length === 0) {
    return NextResponse.json({ error: "Keep at least one bucket" }, { status: 400 });
  }

  // Reassign this bucket's threads over the remaining buckets in one LLM pass,
  // then drop the bucket. On LLM failure the FK's on-delete leaves them
  // unclassified rather than losing the delete.
  const orphans = await db
    .select()
    .from(threads)
    .where(and(eq(threads.userEmail, userEmail), eq(threads.bucketId, id)));
  const criteria = remaining.map((b) => ({ name: b.name, description: b.description }));
  const byName = new Map(remaining.map((b) => [b.name.toLowerCase(), b]));

  const reassigned: {
    id: string;
    bucketId: string;
    bucket: string;
    confidence: number;
    reason: string;
  }[] = [];
  if (orphans.length > 0) {
    try {
      // Corrections into the deleted bucket no longer point anywhere; the
      // remaining ones still guide the reassignment.
      const corrections = await fetchCorrections(
        userEmail,
        new Set(orphans.map((t) => t.id)),
      );
      const limit = pLimit(CLASSIFY_CONCURRENCY);
      const results = (
        await Promise.all(
          chunk(orphans, CLASSIFY_BATCH_SIZE).map((batch) =>
            limit(() =>
              classifyBatch(
                batch.map((t) => ({
                  id: t.id,
                  sender: t.sender,
                  subject: t.subject,
                  snippet: t.snippet,
                  date: t.internalDate?.toISOString() ?? null,
                })),
                criteria,
                corrections,
              ),
            ),
          ),
        )
      ).flat();
      const now = new Date();
      const writeLimit = pLimit(10);
      await Promise.all(
        results.map((r) =>
          writeLimit(async () => {
            const target = byName.get(r.bucket.toLowerCase());
            if (!target) return;
            await db
              .update(threads)
              .set({
                bucketId: target.id,
                confidence: r.confidence,
                reason: r.reason,
                classifiedAt: now,
                // The human placement died with its bucket.
                correctedAt: null,
              })
              .where(
                and(eq(threads.id, r.id), eq(threads.userEmail, userEmail)),
              );
            reassigned.push({
              id: r.id,
              bucketId: target.id,
              bucket: target.name,
              confidence: r.confidence,
              reason: r.reason,
            });
          }),
        ),
      );
    } catch {
      // Fall through: unreassigned threads go unclassified via FK on-delete.
    }
  }

  await db.delete(buckets).where(eq(buckets.id, id));
  return NextResponse.json({ deleted: id, reassigned });
}
