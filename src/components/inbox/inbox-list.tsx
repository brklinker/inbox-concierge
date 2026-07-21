"use client";

import type { ApiThread } from "@/lib/types";
import { ThreadRow } from "./thread-row";

export function InboxList({
  threads,
  bucketNameById,
  showBucket,
  isClassifying,
  emptyMessage,
  onOpen,
}: {
  threads: ApiThread[];
  bucketNameById: Map<string, string>;
  showBucket: boolean;
  isClassifying: boolean;
  emptyMessage: string;
  onOpen: (thread: ApiThread) => void;
}) {
  if (threads.length === 0) {
    return (
      <div className="px-3 py-12 text-center text-sm text-muted-foreground">
        {emptyMessage}
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
          showBucket={showBucket}
          isClassifying={isClassifying}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}
