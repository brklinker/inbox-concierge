import { db } from "@/db";
import { buckets } from "@/db/schema";
import { eq } from "drizzle-orm";

// Descriptions do double duty: they are the LLM's classification criteria and
// (for custom buckets) the embedding source, so they're written as decision
// rules, not marketing copy.
const DEFAULT_BUCKETS = [
  {
    name: "Important",
    description:
      "Needs the user's attention or a reply soon: direct personal mail, recruiting and job-related threads, interviews, deadlines, bills due, anything time-sensitive or high-stakes.",
  },
  {
    name: "Can Wait",
    description:
      "Legitimate mail worth reading eventually, but nothing breaks if it waits: non-urgent personal or work threads, community updates, longer-form messages with no deadline.",
  },
  {
    name: "Newsletter",
    description:
      "Subscribed periodic content addressed to a list, not to the user personally: newsletters, digests, blog updates, editorial mailings.",
  },
  {
    name: "Notifications",
    description:
      "Automated transactional alerts from services the user actually uses: receipts, order and shipping updates, security alerts, calendar invites, statements, social notifications.",
  },
  {
    name: "Auto-Archive",
    description:
      "Noise the user never needs to see: cold marketing, promotions, spammy outreach, duplicate notifications with no informational value. Only assign when clearly worthless.",
  },
];

export async function seedDefaultBuckets(userEmail: string) {
  const existing = await db
    .select({ id: buckets.id })
    .from(buckets)
    .where(eq(buckets.userEmail, userEmail))
    .limit(1);
  if (existing.length > 0) return;
  await db.insert(buckets).values(
    DEFAULT_BUCKETS.map((b, i) => ({
      userEmail,
      name: b.name,
      description: b.description,
      isDefault: true,
      position: i,
    })),
  );
}
