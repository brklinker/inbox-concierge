import { db } from "@/db";
import { buckets, threads } from "@/db/schema";
import {
  CORRECTION_EXAMPLE_LIMIT,
  type CorrectionExample,
} from "./classify";
import { and, desc, eq, isNotNull } from "drizzle-orm";

/**
 * Most recent manual corrections, formatted for the classification prompt.
 * `excludeIds` keeps a thread's own correction out of the prompt when that
 * thread is being (re)classified — matters for the eval, where gold-labeled
 * threads may also have been corrected.
 */
export async function fetchCorrections(
  userEmail: string,
  excludeIds: ReadonlySet<string> = new Set(),
): Promise<CorrectionExample[]> {
  const rows = await db
    .select({
      id: threads.id,
      sender: threads.sender,
      subject: threads.subject,
      snippet: threads.snippet,
      bucket: buckets.name,
    })
    .from(threads)
    .innerJoin(buckets, eq(threads.bucketId, buckets.id))
    .where(and(eq(threads.userEmail, userEmail), isNotNull(threads.correctedAt)))
    .orderBy(desc(threads.correctedAt))
    .limit(CORRECTION_EXAMPLE_LIMIT + 50);
  return rows
    .filter((r) => !excludeIds.has(r.id))
    .slice(0, CORRECTION_EXAMPLE_LIMIT)
    .map((r) => ({
      sender: r.sender,
      subject: r.subject,
      snippet: r.snippet,
      bucket: r.bucket,
    }));
}
