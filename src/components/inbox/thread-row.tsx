"use client";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatDate, senderName } from "@/lib/format";
import type { ApiThread } from "@/lib/types";

const LOW_CONFIDENCE = 0.6;

export function ThreadRow({
  thread,
  bucketName,
  showBucket,
  isClassifying,
}: {
  thread: ApiThread;
  bucketName: string | null;
  showBucket: boolean;
  isClassifying: boolean;
}) {
  const row = (
    <div className="flex items-baseline gap-3 border-b px-3 py-2 text-sm">
      <span className="w-40 shrink-0 truncate font-medium">
        {senderName(thread.sender)}
      </span>
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium">{thread.subject || "(no subject)"}</span>
        {thread.snippet && (
          <span className="text-muted-foreground"> — {thread.snippet}</span>
        )}
      </span>
      {showBucket && bucketName && (
        <Badge variant="secondary" className="shrink-0">
          {bucketName}
        </Badge>
      )}
      {!thread.bucketId && isClassifying && (
        <Badge variant="outline" className="shrink-0 text-muted-foreground">
          sorting…
        </Badge>
      )}
      {thread.confidence !== null && thread.confidence < LOW_CONFIDENCE && (
        <Badge variant="outline" className="shrink-0">
          low confidence
        </Badge>
      )}
      <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">
        {formatDate(thread.internalDate)}
      </span>
    </div>
  );

  if (!thread.reason) return row;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{row}</TooltipTrigger>
      <TooltipContent side="bottom" align="start">
        {thread.reason}
        {thread.confidence !== null &&
          ` (confidence ${Math.round(thread.confidence * 100)}%)`}
      </TooltipContent>
    </Tooltip>
  );
}
