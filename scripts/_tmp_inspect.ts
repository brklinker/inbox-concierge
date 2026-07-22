import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { db } from "@/db";
import { buckets, threads } from "@/db/schema";
import { eq, isNotNull, and } from "drizzle-orm";

async function main() {
  const userEmail = "bklinker13@gmail.com";
  const bs = await db.select().from(buckets).where(eq(buckets.userEmail, userEmail));
  console.log("=== BUCKETS ===");
  for (const b of bs) console.log(`[${b.isDefault ? "default" : "custom"}] ${b.name}: ${b.description}`);

  const gold = await db
    .select({ id: threads.id, gold: threads.goldLabel, sender: threads.sender, subject: threads.subject })
    .from(threads)
    .where(and(eq(threads.userEmail, userEmail), isNotNull(threads.goldLabel)));

  const counts = new Map<string, number>();
  for (const t of gold) counts.set(t.gold!, (counts.get(t.gold!) ?? 0) + 1);
  console.log("\n=== GOLD COUNTS ===");
  for (const [k, v] of counts) console.log(`${k}: ${v}`);

  console.log("\n=== GOLD 'Can Wait' (stale — bucket deleted) ===");
  for (const t of gold.filter((g) => g.gold === "Can Wait"))
    console.log(`${t.id} | ${t.sender} | ${t.subject}`);

  console.log("\n=== GOLD Important (job-search-related check) ===");
  for (const t of gold.filter((g) => g.gold === "Important"))
    console.log(`${t.id} | ${(t.sender ?? "").slice(0, 45)} | ${(t.subject ?? "").slice(0, 70)}`);

  console.log("\n=== GOLD Recruiters ===");
  for (const t of gold.filter((g) => g.gold === "Recruiters"))
    console.log(`${t.id} | ${(t.sender ?? "").slice(0, 45)} | ${(t.subject ?? "").slice(0, 70)}`);
  process.exit(0);
}

main();
