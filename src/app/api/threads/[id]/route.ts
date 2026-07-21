import { auth } from "@/auth";
import { db } from "@/db";
import { buckets, threads } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// Manual re-file. Marks the thread as human-placed: it won't be
// reclassified, auto-reviewed, or auto-moved again, and it feeds future
// classification prompts as an example of this user's preferences.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.email || session.error) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userEmail = session.user.email;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { bucketId?: string };
  if (!body.bucketId) {
    return NextResponse.json({ error: "bucketId required" }, { status: 400 });
  }
  const [bucket] = await db
    .select()
    .from(buckets)
    .where(and(eq(buckets.id, body.bucketId), eq(buckets.userEmail, userEmail)));
  if (!bucket) {
    return NextResponse.json({ error: "Bucket not found" }, { status: 404 });
  }
  const now = new Date();
  const [updated] = await db
    .update(threads)
    .set({
      bucketId: bucket.id,
      confidence: 1,
      reason: "Re-filed by you",
      classifiedAt: now,
      correctedAt: now,
    })
    .where(and(eq(threads.id, id), eq(threads.userEmail, userEmail)))
    .returning({ id: threads.id });
  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({
    id: updated.id,
    bucketId: bucket.id,
    bucket: bucket.name,
    confidence: 1,
    reason: "Re-filed by you",
  });
}
