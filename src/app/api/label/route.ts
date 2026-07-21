import { auth } from "@/auth";
import { db } from "@/db";
import { threads } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email || session.error) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    threadId?: string;
    goldLabel?: string | null;
  };
  if (!body.threadId) {
    return NextResponse.json({ error: "threadId required" }, { status: 400 });
  }
  const [updated] = await db
    .update(threads)
    .set({ goldLabel: body.goldLabel ?? null })
    .where(
      and(
        eq(threads.id, body.threadId),
        eq(threads.userEmail, session.user.email),
      ),
    )
    .returning({ id: threads.id, goldLabel: threads.goldLabel });
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(updated);
}
