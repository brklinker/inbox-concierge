"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface ReviewSummary {
  reviewed: number;
  corrections: { id: string; bucket: string | null; previousBucket: string }[];
}

export function ConsistencyIndicator({ summary }: { summary: ReviewSummary | null }) {
  if (!summary || summary.reviewed === 0) return null;
  const label = `${summary.reviewed} thread${summary.reviewed === 1 ? "" : "s"} auto-reviewed, ${summary.corrections.length} corrected`;
  if (summary.corrections.length === 0) {
    return <span className="text-xs text-muted-foreground">✓ {label}</span>;
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-default text-xs text-muted-foreground underline decoration-dotted">
          ✓ {label}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start">
        <ul>
          {summary.corrections.map((c) => (
            <li key={c.id}>
              {c.previousBucket} → {c.bucket}
            </li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}
