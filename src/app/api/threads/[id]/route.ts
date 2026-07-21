import { auth } from "@/auth";
import { db } from "@/db";
import { buckets, threads } from "@/db/schema";
import { getThreadMessages } from "@/lib/gmail";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// Full bodies for the read view. On-demand only: the response goes straight
// to the client and nothing here touches the database.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.email || !session.accessToken || session.error) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  try {
    // The Gmail call runs with the user's own token, so it can only ever
    // reach threads in their mailbox.
    const messages = await getThreadMessages(session.accessToken, id);
    return NextResponse.json({ messages });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}

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
