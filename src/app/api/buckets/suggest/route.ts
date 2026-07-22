import { auth } from "@/auth";
import { db } from "@/db";
import { buckets, threads } from "@/db/schema";
import { suggestBuckets, type ClusterSample } from "@/lib/classify";
import { kmeans } from "@/lib/cluster";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { topK } from "@/lib/similarity";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_CLUSTERS = 7;
const MIN_CLUSTER_SIZE = 8;
const EXAMPLES_PER_CLUSTER = 8;

export async function POST() {
  const session = await auth();
  if (!session?.user?.email || session.error) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userEmail = session.user.email;
  const rl = rateLimit(`suggest:${userEmail}`, 10, 10 * 60_000);
  if (!rl.ok) return rateLimitResponse(rl.retryAfterSeconds);

  const pool = await db
    .select({
      id: threads.id,
      sender: threads.sender,
      subject: threads.subject,
      snippet: threads.snippet,
      embedding: threads.embedding,
    })
    .from(threads)
    .where(and(eq(threads.userEmail, userEmail), isNotNull(threads.embedding)));
  if (pool.length < MIN_CLUSTER_SIZE * 2) {
    return NextResponse.json({ suggestions: [] });
  }
  const existing = await db
    .select()
    .from(buckets)
    .where(eq(buckets.userEmail, userEmail))
    .orderBy(asc(buckets.position));

  const byId = new Map(pool.map((t) => [t.id, t]));
  const clusters = kmeans(
    pool.map((t) => ({ id: t.id, embedding: t.embedding! })),
    Math.min(MAX_CLUSTERS, Math.floor(pool.length / MIN_CLUSTER_SIZE)),
  ).filter((c) => c.memberIds.length >= MIN_CLUSTER_SIZE);

  const samples: ClusterSample[] = clusters.map((c, clusterIndex) => {
    const members = c.memberIds.map((id) => byId.get(id)!);
    const representative = topK(
      c.centroid,
      members.map((m) => ({ id: m.id, embedding: m.embedding! })),
      EXAMPLES_PER_CLUSTER,
    ).map((n) => byId.get(n.id)!);
    return {
      clusterIndex,
      size: members.length,
      examples: representative.map((t) => ({
        sender: t.sender,
        subject: t.subject,
        snippet: t.snippet?.slice(0, 120) ?? null,
      })),
    };
  });

  const proposals = await suggestBuckets(
    samples,
    existing.map((b) => ({ name: b.name, description: b.description })),
  );

  return NextResponse.json({
    suggestions: proposals.map((p) => {
      const cluster = samples[p.clusterIndex];
      return {
        name: p.name,
        description: p.description,
        size: cluster?.size ?? 0,
        exampleSubjects:
          cluster?.examples
            .map((e) => e.subject)
            .filter((s): s is string => !!s)
            .slice(0, 3) ?? [],
      };
    }),
  });
}
