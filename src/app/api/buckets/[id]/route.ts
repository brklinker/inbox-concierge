import { auth } from "@/auth";
import { db } from "@/db";
import { buckets, threads } from "@/db/schema";
import {
  CLASSIFY_BATCH_SIZE,
  CLASSIFY_CONCURRENCY,
  chunk,
  classifyBatch,
} from "@/lib/classify";
import { embedTexts } from "@/lib/openai";
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
  const { id } = await params;
  const bucket = await ownedBucket(id, session.user.email);
  if (!bucket) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (bucket.isDefault) {
    return NextResponse.json({ error: "Default buckets can't be edited" }, { status: 400 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    description?: string;
  };
  const name = body.name?.trim() || bucket.name;
  const description = body.description?.trim() ?? bucket.description;
  const [embedding] = await embedTexts([`${name}. ${description ?? ""}`.trim()]);
  const [updated] = await db
    .update(buckets)
    .set({ name, description, embedding })
    .where(eq(buckets.id, id))
    .returning();
  return NextResponse.json({ bucket: toApiBucket(updated) });
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
  const { id } = await params;
  const bucket = await ownedBucket(id, userEmail);
  if (!bucket) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (bucket.isDefault) {
    return NextResponse.json({ error: "Default buckets can't be deleted" }, { status: 400 });
  }

  // Reassign this bucket's threads over the remaining buckets in one LLM pass,
  // then drop the bucket. On LLM failure the FK's on-delete leaves them
  // unclassified rather than losing the delete.
  const orphans = await db
    .select()
    .from(threads)
    .where(and(eq(threads.userEmail, userEmail), eq(threads.bucketId, id)));
  const remaining = await db
    .select()
    .from(buckets)
    .where(and(eq(buckets.userEmail, userEmail), ne(buckets.id, id)))
    .orderBy(asc(buckets.position));
  const criteria = remaining.map((b) => ({ name: b.name, description: b.description }));
  const byName = new Map(remaining.map((b) => [b.name.toLowerCase(), b]));

  const reassigned: {
    id: string;
    bucketId: string;
    bucket: string;
    confidence: number;
    reason: string;
  }[] = [];
  if (orphans.length > 0 && remaining.length > 0) {
    try {
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
