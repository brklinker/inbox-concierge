import { auth } from "@/auth";
import { db } from "@/db";
import { buckets, threads } from "@/db/schema";
import { seedDefaultBuckets } from "@/lib/default-buckets";
import { getThreadMetadata, listThreadIds } from "@/lib/gmail";
import { toApiBucket } from "@/lib/serialize";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email || !session.accessToken || session.error) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userEmail = session.user.email;
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";

  await seedDefaultBuckets(userEmail);

  let ids: string[];
  try {
    ids = await listThreadIds(session.accessToken, 200);
  } catch (e) {
    return NextResponse.json(
      { error: `Gmail fetch failed: ${e instanceof Error ? e.message : e}` },
      { status: 502 },
    );
  }

  if (ids.length > 0) {
    // Only fetch metadata for threads we haven't seen; on refresh, refetch all
    // (a thread's snippet/date move when new replies arrive).
    const known = refresh
      ? new Set<string>()
      : new Set(
          (
            await db
              .select({ id: threads.id })
              .from(threads)
              .where(eq(threads.userEmail, userEmail))
          ).map((t) => t.id),
        );
    const toFetch = ids.filter((id) => !known.has(id));

    if (toFetch.length > 0) {
      const metas = await Promise.all(
        toFetch.map((id) => getThreadMetadata(session.accessToken!, id)),
      );
      await db
        .insert(threads)
        .values(metas.map((m) => ({ ...m, userEmail })))
        .onConflictDoUpdate({
          target: threads.id,
          set: {
            subject: sql`excluded.subject`,
            sender: sql`excluded.sender`,
            senderDomain: sql`excluded.sender_domain`,
            snippet: sql`excluded.snippet`,
            internalDate: sql`excluded.internal_date`,
          },
        });
    }
  }

  const [threadRows, bucketRows] = await Promise.all([
    ids.length > 0
      ? db
          .select({
            id: threads.id,
            subject: threads.subject,
            sender: threads.sender,
            senderDomain: threads.senderDomain,
            snippet: threads.snippet,
            internalDate: threads.internalDate,
            bucketId: threads.bucketId,
            confidence: threads.confidence,
            reason: threads.reason,
            classifiedAt: threads.classifiedAt,
          })
          .from(threads)
          .where(and(inArray(threads.id, ids), eq(threads.userEmail, userEmail)))
          .orderBy(desc(threads.internalDate))
      : Promise.resolve([]),
    db
      .select()
      .from(buckets)
      .where(eq(buckets.userEmail, userEmail))
      .orderBy(asc(buckets.position)),
  ]);

  return NextResponse.json({
    threads: threadRows,
    buckets: bucketRows.map(toApiBucket),
  });
}
