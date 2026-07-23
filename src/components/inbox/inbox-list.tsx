"use client";

import type { ApiThread } from "@/lib/types";
import { ThreadRow, type MoveTarget } from "./thread-row";

export function InboxList({
  threads,
  bucketNameById,
  badgeClassById,
  moveTargets,
  isClassifying,
  emptyMessage,
  onMove,
  reasonById,
}: {
  threads: ApiThread[];
  bucketNameById: Map<string, string>;
  badgeClassById: Map<string, string>;
  moveTargets: MoveTarget[];
  isClassifying: boolean;
  emptyMessage: string;
  onMove: (thread: ApiThread, bucketId: string) => void;
  /** Optional per-thread search-match reasons (search-results mode). */
  reasonById?: Map<string, string>;
}) {
  if (threads.length === 0) {
    return (
      <div className="px-2.5 py-16 text-center">
        <div className="text-xl font-semibold">Nothing here yet</div>
        <p className="mt-1 text-sm text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }
  return (
    <div>
      {threads.map((t) => (
        <ThreadRow
          key={t.id}
          thread={t}
          bucketName={t.bucketId ? (bucketNameById.get(t.bucketId) ?? null) : null}
          badgeClass={t.bucketId ? (badgeClassById.get(t.bucketId) ?? null) : null}
          isClassifying={isClassifying}
          moveTargets={moveTargets}
          onMove={onMove}
          matchReason={reasonById?.get(t.id) ?? null}
        />
      ))}
    </div>
  );
}
