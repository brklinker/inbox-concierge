/**
 * Eval harness: runs the production classification code path against every
 * thread with a hand-assigned gold label and reports agreement.
 *
 *   npm run eval            # writes evals/results/<date>-<PROMPT_VERSION>.txt
 *   npm run eval -- --dry   # print only, don't write the results file
 *
 * Env comes from .env.local (DATABASE_URL, OPENAI_API_KEY).
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { db } from "@/db";
import { buckets, threads } from "@/db/schema";
import {
  CLASSIFY_BATCH_SIZE,
  CLASSIFY_CONCURRENCY,
  PROMPT_VERSION,
  chunk,
  classifyBatch,
} from "@/lib/classify";
import { fetchCorrections } from "@/lib/corrections";
import { asc, eq, isNotNull } from "drizzle-orm";
import { mkdirSync, writeFileSync } from "node:fs";
import pLimit from "p-limit";

// A gold-Important thread predicted Auto-Archive is the failure mode the whole
// prompt is designed against ("a buried job offer"). Tracked as its own number.
const CATASTROPHIC = { gold: "Important", predicted: "Auto-Archive" };

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function table(rows: string[][]): string {
  const widths = rows[0].map((_, col) =>
    Math.max(...rows.map((r) => (r[col] ?? "").length)),
  );
  return rows
    .map((r) => r.map((cell, i) => (cell ?? "").padStart(widths[i])).join("  "))
    .join("\n");
}

async function main() {
  const gold = await db
    .select()
    .from(threads)
    .where(isNotNull(threads.goldLabel));
  if (gold.length === 0) {
    console.error("No gold labels found. Label threads at /label first.");
    process.exit(1);
  }

  const userEmails = [...new Set(gold.map((t) => t.userEmail))];
  const out: string[] = [];
  const log = (line = "") => {
    out.push(line);
    console.log(line);
  };

  log(`Eval — prompt ${PROMPT_VERSION} — ${new Date().toISOString()}`);
  log(`Gold set: ${gold.length} threads across ${userEmails.length} user(s)`);
  log();

  const predictions = new Map<string, string>();
  for (const userEmail of userEmails) {
    const userBuckets = await db
      .select()
      .from(buckets)
      .where(eq(buckets.userEmail, userEmail))
      .orderBy(asc(buckets.position));
    const criteria = userBuckets.map((b) => ({
      name: b.name,
      description: b.description,
    }));
    const userGold = gold.filter((t) => t.userEmail === userEmail);
    // Same code path as production, including correction examples — but a
    // gold thread's own correction never rides along in its prompt.
    const corrections = await fetchCorrections(
      userEmail,
      new Set(userGold.map((t) => t.id)),
    );
    const limit = pLimit(CLASSIFY_CONCURRENCY);
    const results = (
      await Promise.all(
        chunk(userGold, CLASSIFY_BATCH_SIZE).map((batch) =>
          limit(() =>
            classifyBatch(
              batch.map((t) => ({
                id: t.id,
                sender: t.sender,
                subject: t.subject,
                snippet: t.snippet,
                date: t.internalDate?.toISOString() ?? null,
              })),
              criteria,
              corrections,
            ),
          ),
        ),
      )
    ).flat();
    for (const r of results) predictions.set(r.id, r.bucket);
  }

  const labels = [
    ...new Set([...gold.map((t) => t.goldLabel!), ...predictions.values()]),
  ].sort();
  let correct = 0;
  let catastrophic = 0;
  const confusion = new Map<string, number>();
  const misses: typeof gold = [];
  for (const t of gold) {
    const predicted = predictions.get(t.id) ?? "(none)";
    if (predicted === t.goldLabel) correct += 1;
    else misses.push(t);
    if (t.goldLabel === CATASTROPHIC.gold && predicted === CATASTROPHIC.predicted) {
      catastrophic += 1;
    }
    const key = `${t.goldLabel}→${predicted}`;
    confusion.set(key, (confusion.get(key) ?? 0) + 1);
  }

  log(`Overall accuracy: ${correct}/${gold.length} (${pct(correct / gold.length)})`);
  log(`Catastrophic misses (gold ${CATASTROPHIC.gold} → ${CATASTROPHIC.predicted}): ${catastrophic}`);
  log();

  log("Per-bucket precision/recall:");
  const prRows: string[][] = [["bucket", "precision", "recall", "gold n"]];
  for (const label of labels) {
    const goldN = gold.filter((t) => t.goldLabel === label).length;
    const predictedN = [...predictions.values()].filter((p) => p === label).length;
    const hit = confusion.get(`${label}→${label}`) ?? 0;
    prRows.push([
      label,
      predictedN > 0 ? pct(hit / predictedN) : "—",
      goldN > 0 ? pct(hit / goldN) : "—",
      String(goldN),
    ]);
  }
  log(table(prRows));
  log();

  log("Confusion matrix (rows = gold, cols = predicted):");
  const matrixRows: string[][] = [["", ...labels]];
  for (const g of labels) {
    matrixRows.push([
      g,
      ...labels.map((p) => String(confusion.get(`${g}→${p}`) ?? 0)),
    ]);
  }
  log(table(matrixRows));
  log();

  if (misses.length > 0) {
    log("Misses:");
    for (const t of misses) {
      log(
        `- [${t.goldLabel} → ${predictions.get(t.id) ?? "(none)"}] ${t.sender ?? "?"} | ${t.subject ?? "(no subject)"} | ${(t.snippet ?? "").slice(0, 80)}`,
      );
    }
  }

  if (!process.argv.includes("--dry")) {
    const date = new Date().toISOString().slice(0, 10);
    const path = `evals/results/${date}-${PROMPT_VERSION}.txt`;
    mkdirSync("evals/results", { recursive: true });
    writeFileSync(path, out.join("\n") + "\n");
    console.log(`\nWrote ${path}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
