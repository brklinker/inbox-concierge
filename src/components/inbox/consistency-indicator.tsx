"use client";

export interface ReviewSummary {
  reviewed: number;
  corrections: { id: string; bucket: string | null; previousBucket: string }[];
}

export function ConsistencyIndicator({
  summary,
  onDismiss,
}: {
  summary: ReviewSummary | null;
  onDismiss: () => void;
}) {
  if (!summary || summary.reviewed === 0) return null;
  const corrected = summary.corrections.length;
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
            {corrected}
          </span>
          <span className="text-[13px] text-muted-foreground">
            re-filed for consistency
          </span>
        </span>
      </div>
      <p className="mb-0 mt-2.5 max-w-[54ch] text-[15px]">
        {corrected > 0
          ? "The concierge cross-checked its own work: these threads sat oddly against similar ones and were quietly corrected. Your buckets now agree with each other."
          : "The concierge cross-checked its own work against similar threads and confirmed every placement."}
      </p>
    </div>
  );
}
