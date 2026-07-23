import { auth } from "@/auth";
import { db } from "@/db";
import { buckets, threads } from "@/db/schema";
import { answerInboxQuery, type SearchCandidate } from "@/lib/classify";
import { embedTexts } from "@/lib/openai";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { selectSearchCandidates } from "@/lib/search";
import { and, eq, isNotNull } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_QUERY_LENGTH = 200;

// Ask-your-inbox: a natural-language query over the user's own mail. Two
// stages, the same cascade as classification — cheap embedding retrieval
// narrows 200 threads to a handful, then one LLM call judges and answers.
// Read-only and metadata-only, like everything else here.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email || session.error) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userEmail = session.user.email;
  const rl = rateLimit(`search:${userEmail}`, 20, 5 * 60_000);
  if (!rl.ok) return rateLimitResponse(rl.retryAfterSeconds);

  const body = (await req.json().catch(() => ({}))) as { query?: string };
  const query = (body.query ?? "").trim().slice(0, MAX_QUERY_LENGTH);
  if (!query) {
    return NextResponse.json({ error: "Empty query" }, { status: 400 });
  }

  const pool = await db
    .select({
      id: threads.id,
      sender: threads.sender,
      subject: threads.subject,
      snippet: threads.snippet,
      internalDate: threads.internalDate,
      bucketId: threads.bucketId,
      embedding: threads.embedding,
    })
    .from(threads)
    .where(and(eq(threads.userEmail, userEmail), isNotNull(threads.embedding)));

  if (pool.length === 0) {
    return NextResponse.json({
      answer: "Nothing to search yet — sort your inbox first.",
      results: [],
      scanned: 0,
      evaluated: 0,
      matched: 0,
    });
  }

  const bucketNameById = new Map(
    (
      await db
        .select({ id: buckets.id, name: buckets.name })
        .from(buckets)
        .where(eq(buckets.userEmail, userEmail))
    ).map((b) => [b.id, b.name]),
  );

  let queryEmbedding: number[];
  try {
    [queryEmbedding] = await embedTexts([query]);
  } catch (e) {
    return NextResponse.json(
      { error: `Search failed: ${e instanceof Error ? e.message : e}` },
      { status: 502 },
    );
  }

  const { neighbors, belowFloor } = selectSearchCandidates(
    queryEmbedding,
    pool.map((t) => ({ id: t.id, embedding: t.embedding! })),
  );

  if (belowFloor) {
    return NextResponse.json({
      answer: `Nothing in your inbox looks related to “${query}”.`,
      results: [],
      scanned: pool.length,
      evaluated: 0,
      matched: 0,
    });
  }

  const byId = new Map(pool.map((t) => [t.id, t]));
  const candidates: SearchCandidate[] = neighbors.map((n) => {
    const t = byId.get(n.id)!;
    return {
      id: t.id,
      sender: t.sender,
      subject: t.subject,
      snippet: t.snippet,
      date: t.internalDate ? t.internalDate.toISOString() : null,
      bucket: t.bucketId ? (bucketNameById.get(t.bucketId) ?? null) : null,
    };
  });

  let result;
  try {
    result = await answerInboxQuery(query, candidates);
  } catch (e) {
    return NextResponse.json(
      { error: `Search failed: ${e instanceof Error ? e.message : e}` },
      { status: 502 },
    );
  }

  return NextResponse.json({
    answer: result.answer,
    results: result.matches,
    scanned: pool.length,
    evaluated: candidates.length,
    matched: result.matches.length,
  });
}
