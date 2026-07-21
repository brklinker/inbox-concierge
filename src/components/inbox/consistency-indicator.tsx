"use client";

import { senderName } from "@/lib/format";
import type { ApiThread } from "@/lib/types";

export interface ReviewSummary {
  reviewed: number;
  corrections: {
    id: string;
    bucketId: string | null;
    bucket: string | null;
    previousBucket: string;
  }[];
}

export function ConsistencyIndicator({
  summary,
  resolveThread,
  onJumpToBucket,
  onDismiss,
}: {
  summary: ReviewSummary | null;
  resolveThread: (id: string) => ApiThread | undefined;
  onJumpToBucket: (bucketId: string) => void;
  onDismiss: () => void;
}) {
  if (!summary || summary.reviewed === 0) return null;
  const corrections = summary.corrections
    .map((c) => ({ ...c, thread: resolveThread(c.id) }))
    .filter((c): c is typeof c & { thread: ApiThread } => !!c.thread);

  return (
    <div
      className="ribbon anim-arrive mb-5"
      style={{ borderTopColor: "var(--press2)" }}
    >
      <div className="flex items-start">
        <div className="kicker text-press2-700">Consistency auto-review</div>
        <button
          className="ml-auto text-xs text-press2-700 underline-offset-2 hover:underline"
          onClick={onDismiss}
        >
          Dismiss
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-8 gap-y-1.5">
        <span className="flex items-baseline gap-2">
          <span className="anim-pop text-[38px] font-semibold leading-none">
            {summary.reviewed}
          </span>
          <span className="text-[13px] text-muted-foreground">
            thread{summary.reviewed === 1 ? "" : "s"} auto-reviewed
          </span>
        </span>
        <span className="flex items-baseline gap-2">
          <span
            className="anim-pop text-[38px] font-semibold leading-none text-press2-700"
            style={{ animationDelay: "0.12s" }}
          >
            {corrections.length}
          </span>
          <span className="text-[13px] text-muted-foreground">
            re-filed for consistency
          </span>
        </span>
      </div>
      {corrections.length > 0 ? (
        <>
          <p className="mb-0 mt-2.5 max-w-[54ch] text-[15px]">
            These sat oddly next to similar threads and were re-filed. Click to
            view — a thread&apos;s badge moves it back, and the concierge learns
            from that.
          </p>
          <ul className="mt-3 border-t border-ink/10">
            {corrections.map((c) => (
              <li key={c.id} className="border-b border-ink/10">
                <button
                  className="flex w-full items-baseline gap-3 px-1 py-2 text-left hover:bg-ink/[0.035]"
                  onClick={() => c.bucketId && onJumpToBucket(c.bucketId)}
                >
                  <span className="min-w-0 flex-1 truncate text-sm">
                    <span className="font-semibold">
                      {senderName(c.thread.sender)}
                    </span>
                    <span className="text-muted-foreground">
                      {" "}
                      — {c.thread.subject || "(no subject)"}
                    </span>
                  </span>
                  <span className="flex-none text-[13px] text-muted-foreground">
                    {c.previousBucket}{" "}
                    <span className="text-press2-700">→ {c.bucket}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mb-0 mt-2.5 max-w-[54ch] text-[15px]">
          Cross-checked against similar threads — every placement confirmed.
        </p>
      )}
    </div>
  );
}
