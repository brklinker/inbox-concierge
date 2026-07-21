// Broadsheet tone assignment: each bucket gets a section dot color and a tag
// (badge) treatment. The brief's default buckets match the design mock;
// custom buckets cycle through the process inks.

export interface BucketTone {
  dot: string;
  badgeClass: string;
}

const NAMED: Record<string, BucketTone> = {
  important: { dot: "var(--press)", badgeClass: "tag tag-accent" },
  "can wait": { dot: "var(--color-neutral-500)", badgeClass: "tag tag-neutral" },
  newsletter: { dot: "var(--color-press2-500)", badgeClass: "tag tag-accent-2" },
  notifications: { dot: "var(--color-press-700)", badgeClass: "tag tag-accent" },
  "auto-archive": { dot: "var(--color-neutral-400)", badgeClass: "tag tag-outline" },
};

const CYCLE: BucketTone[] = [
  { dot: "var(--press)", badgeClass: "tag tag-accent" },
  { dot: "var(--color-press2-500)", badgeClass: "tag tag-accent-2" },
  { dot: "var(--color-neutral-500)", badgeClass: "tag tag-neutral" },
  { dot: "var(--color-press-700)", badgeClass: "tag tag-outline" },
];

export function bucketTone(name: string, index: number): BucketTone {
  return NAMED[name.toLowerCase()] ?? CYCLE[index % CYCLE.length];
}
