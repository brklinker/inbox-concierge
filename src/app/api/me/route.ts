import { auth } from "@/auth";
import { db } from "@/db";
import { buckets, threads } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Self-serve version of the README's privacy promise: delete everything
// stored for this account. Sign-in again reseeds from scratch.
export async function DELETE() {
  const session = await auth();
  if (!session?.user?.email || session.error) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userEmail = session.user.email;
  const deletedThreads = await db
    .delete(threads)
    .where(eq(threads.userEmail, userEmail))
    .returning({ id: threads.id });
  const deletedBuckets = await db
    .delete(buckets)
    .where(eq(buckets.userEmail, userEmail))
    .returning({ id: buckets.id });
  return NextResponse.json({
    threads: deletedThreads.length,
    buckets: deletedBuckets.length,
  });
}
