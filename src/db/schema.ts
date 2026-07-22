import {
  boolean,
  index,
  integer,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

export const buckets = pgTable(
  "buckets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userEmail: text("user_email").notNull(),
    name: text("name").notNull(),
    // Used both as the LLM's classification criteria and as the embedding source.
    description: text("description"),
    isDefault: boolean("is_default").default(false).notNull(),
    // Embedded name + description, for candidate retrieval on custom bucket creation.
    embedding: vector("embedding", { dimensions: 1536 }),
    position: integer("position").default(0).notNull(),
  },
  (table) => [index("buckets_user_email_idx").on(table.userEmail)],
);

export const threads = pgTable(
  "threads",
  {
    // Gmail thread id.
    id: text("id").primaryKey(),
    userEmail: text("user_email").notNull(),
    subject: text("subject"),
    // Display name + email of the original sender.
    sender: text("sender"),
    senderDomain: text("sender_domain"),
    snippet: text("snippet"),
    internalDate: timestamp("internal_date", { withTimezone: true }),
    embedding: vector("embedding", { dimensions: 1536 }),
    bucketId: uuid("bucket_id").references(() => buckets.id, {
      onDelete: "set null",
    }),
    confidence: real("confidence"),
    // One short phrase from the classifier; surfaced as a tooltip in the UI.
    reason: text("reason"),
    classifiedAt: timestamp("classified_at", { withTimezone: true }),
    // Set when the user manually re-files a thread. Human placement is
    // authoritative: never reclassified, auto-reviewed, or auto-moved, and
    // recent corrections feed the classification prompt as examples.
    correctedAt: timestamp("corrected_at", { withTimezone: true }),
    // Hand-assigned bucket name from /label; null if unlabeled. Eval ground truth.
    goldLabel: text("gold_label"),
  },
  (table) => [index("threads_user_email_idx").on(table.userEmail)],
);

// Lease serializing classification per user across serverless instances:
// one row per user while a run is in flight. Stale rows (crashed runs)
// are reclaimed by TTL on acquire — see src/lib/classify-lock.ts.
export const classifyLocks = pgTable("classify_locks", {
  userEmail: text("user_email").primaryKey(),
  lockedAt: timestamp("locked_at", { withTimezone: true }).notNull(),
});

export type Bucket = typeof buckets.$inferSelect;
export type Thread = typeof threads.$inferSelect;
