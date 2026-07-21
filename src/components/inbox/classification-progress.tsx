"use client";

export interface ClassifyProgress {
  phase: "idle" | "classifying" | "reviewing" | "done" | "error";
  total: number;
  batches: number;
  completed: number;
  flagged: number;
  error?: string;
}

export function ClassificationProgress({ progress }: { progress: ClassifyProgress }) {
  if (progress.phase === "idle" || progress.phase === "done") return null;
  if (progress.phase === "error") {
    return (
      <div className="ribbon mb-5" style={{ borderTopColor: "var(--press2)" }}>
        <div className="text-lg font-semibold">Sorting hit a snag</div>
        <p className="mt-1 text-sm text-muted-foreground">{progress.error}</p>
      </div>
    );
  }
  const reviewing = progress.phase === "reviewing";
  const processed =
    progress.batches > 0
      ? Math.min(
          progress.total,
          Math.round((progress.total * progress.completed) / progress.batches),
        )
      : 0;
  return (
    <div className="ribbon mb-5">
      <div className="flex items-baseline gap-2.5 text-lg font-semibold">
        <span className="inline-block size-3 animate-spin self-center rounded-full border-2 border-press-300 border-t-press" />
        {reviewing ? (
          <>
            Cross-checking consistency…
            <span className="ml-auto text-sm font-normal text-muted-foreground">
              {progress.flagged} thread{progress.flagged === 1 ? "" : "s"} under
              review
            </span>
          </>
        ) : (
          <>
            Filing threads…
            <span className="ml-auto text-sm font-normal text-muted-foreground">
              {processed} of {progress.total}
            </span>
          </>
        )}
      </div>
      <div className="relative mt-3.5 h-1 overflow-hidden rounded-[2px] bg-neutral-200">
        {reviewing ? (
          <div className="anim-sweep absolute left-0 top-0 h-full w-[38%] bg-press" />
        ) : (
          <div
            className="h-full bg-press transition-[width] duration-300"
            style={{
              width: `${progress.batches > 0 ? Math.round((progress.completed / progress.batches) * 100) : 0}%`,
            }}
          />
        )}
      </div>
    </div>
  );
}
