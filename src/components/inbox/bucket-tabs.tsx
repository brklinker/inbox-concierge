"use client";

import { Button } from "@/components/ui/button";
import type { ApiBucket } from "@/lib/types";

export const ALL_TAB = "all";
export const UNSORTED_TAB = "unsorted";

export function BucketTabs({
  buckets,
  counts,
  unsortedCount,
  totalCount,
  active,
  onSelect,
}: {
  buckets: ApiBucket[];
  counts: Map<string, number>;
  unsortedCount: number;
  totalCount: number;
  active: string;
  onSelect: (id: string) => void;
}) {
  const tab = (id: string, label: string, count: number) => (
    <Button
      key={id}
      size="sm"
      variant={active === id ? "default" : "outline"}
      onClick={() => onSelect(id)}
    >
      {label}
      <span className="ml-1 text-xs opacity-70">{count}</span>
    </Button>
  );
  return (
    <div className="flex flex-wrap items-center gap-2">
      {tab(ALL_TAB, "All", totalCount)}
      {buckets.map((b) => tab(b.id, b.name, counts.get(b.id) ?? 0))}
      {unsortedCount > 0 && tab(UNSORTED_TAB, "Unsorted", unsortedCount)}
    </div>
  );
}
