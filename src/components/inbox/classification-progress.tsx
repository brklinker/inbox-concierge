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
      <p className="text-sm text-destructive">
        Classification failed: {progress.error}
      </p>
    );
  }
  const fraction =
    progress.batches > 0 ? progress.completed / progress.batches : 0;
  return (
    <div className="flex items-center gap-3 text-sm text-muted-foreground">
      <div className="h-1.5 w-40 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${Math.max(4, Math.round(fraction * 100))}%` }}
        />
      </div>
      {progress.phase === "classifying" ? (
        <span>
          Sorting {progress.total} threads — batch {progress.completed}/
          {progress.batches}
        </span>
      ) : (
        <span>Reviewing {progress.flagged} inconsistent threads…</span>
      )}
    </div>
  );
}
