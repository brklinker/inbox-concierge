import { db } from "@/db";
import { classifyLocks } from "@/db/schema";
import { eq, lt } from "drizzle-orm";

// A run may legitimately hold the lease for the classify route's full
// maxDuration (300s); anything older is a crashed run whose lease is safe
// to steal.
const LOCK_TTL_MS = 310_000;

/**
 * Try to take the per-user classify lease. One atomic upsert: insert wins
 * when no lease exists; the conflict update wins only when the held lease
 * is stale. Empty returning() means a live run holds it.
 */
export async function acquireClassifyLock(userEmail: string): Promise<boolean> {
  const now = new Date();
  const rows = await db
    .insert(classifyLocks)
    .values({ userEmail, lockedAt: now })
    .onConflictDoUpdate({
      target: classifyLocks.userEmail,
      set: { lockedAt: now },
      setWhere: lt(classifyLocks.lockedAt, new Date(now.getTime() - LOCK_TTL_MS)),
    })
    .returning({ userEmail: classifyLocks.userEmail });
  return rows.length > 0;
}

export async function releaseClassifyLock(userEmail: string): Promise<void> {
  try {
    await db.delete(classifyLocks).where(eq(classifyLocks.userEmail, userEmail));
  } catch {
    // The TTL reclaims a leaked lease; a failed release must not mask the
    // run's own outcome.
  }
}
