"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatDate, senderName } from "@/lib/format";
import type { ApiThread } from "@/lib/types";
import { useState } from "react";

const LOW_CONFIDENCE = 0.6;

export interface MoveTarget {
  id: string;
  name: string;
  dot: string;
}

export function ThreadRow({
  thread,
  bucketName,
  badgeClass,
  isClassifying,
  moveTargets,
  onOpen,
  onMove,
}: {
  thread: ApiThread;
  bucketName: string | null;
  badgeClass: string | null;
  isClassifying: boolean;
  moveTargets: MoveTarget[];
  onOpen: (thread: ApiThread) => void;
  onMove: (thread: ApiThread, bucketId: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const name = senderName(thread.sender);
  const initial = name.replace(/[^A-Za-z]/g, "").charAt(0).toUpperCase() || "•";
  const sorted = !!thread.bucketId;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(thread)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen(thread);
      }}
      className={`grid cursor-pointer grid-cols-[34px_186px_minmax(0,1fr)_auto] items-center gap-4 border-b border-ink/8 px-2.5 py-3 hover:bg-ink/[0.035] max-md:grid-cols-[34px_minmax(0,1fr)_auto] ${sorted ? "anim-arrive" : ""}`}
    >
      <div className="grid size-8 place-items-center rounded-full bg-neutral-200 text-sm font-semibold text-press-800">
        {initial}
      </div>
      <div className="min-w-0 max-md:hidden">
        <div className="truncate text-sm font-semibold">{name}</div>
        <div className="text-[11px] text-muted-foreground">
          {formatDate(thread.internalDate)}
        </div>
      </div>
      <div className="min-w-0 truncate">
        <span className="text-base font-semibold">
          {thread.subject || "(no subject)"}
        </span>
        {thread.snippet && (
          <span className="text-sm text-muted-foreground"> — {thread.snippet}</span>
        )}
      </div>
      <div className="relative flex items-center justify-end gap-2">
        {!sorted && isClassifying && (
          <span className="flex items-center gap-1.5 text-[13px] italic text-press-700">
            <span className="inline-block size-[11px] animate-spin rounded-full border-2 border-press-200 border-t-press" />
            sorting
          </span>
        )}
        {sorted &&
          thread.confidence !== null &&
          thread.confidence < LOW_CONFIDENCE && (
            <span className="tag tag-accent-2 cursor-default whitespace-nowrap">
              Low confidence
            </span>
          )}
        {sorted && bucketName && badgeClass && (
          <button
            aria-haspopup="menu"
            title="Move to another bucket"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((o) => !o);
            }}
            className={`${badgeClass} cursor-pointer gap-1.5 whitespace-nowrap shadow-[inset_0_0_0_1px_color-mix(in_srgb,currentColor_22%,transparent)] hover:brightness-[.93]`}
          >
            {bucketName}
            <svg
              width="9"
              height="9"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              className="opacity-70"
            >
              <path d="M2.5 4.5 6 8l3.5-3.5" />
            </svg>
          </button>
        )}
        {menuOpen && (
          <>
            <div
              className="fixed inset-0 z-50"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
              }}
            />
            <div
              role="menu"
              className="absolute right-0 top-full z-[60] mt-1 min-w-[184px] rounded-[3px] border border-neutral-400 bg-background p-1 shadow-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="kicker px-2.5 pb-1 pt-1.5 text-muted-foreground">
                Move to
              </div>
              {moveTargets
                .filter((m) => m.id !== thread.bucketId)
                .map((m) => (
                  <button
                    key={m.id}
                    role="menuitem"
                    className="flex w-full items-center gap-2.5 rounded-[2px] px-2.5 py-2 text-left text-sm hover:bg-accent"
                    onClick={() => {
                      setMenuOpen(false);
                      onMove(thread, m.id);
                    }}
                  >
                    <span
                      className="size-2 flex-none rounded-full"
                      style={{ background: m.dot }}
                    />
                    {m.name}
                  </button>
                ))}
            </div>
          </>
        )}
        {sorted && thread.reason && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                aria-label="Why was this sorted here?"
                onClick={(e) => e.stopPropagation()}
                className="size-5 flex-none cursor-help rounded-full border border-border text-xs font-semibold leading-none text-neutral-600"
              >
                i
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="top"
              align="end"
              className="max-w-[260px] bg-ink text-paper"
            >
              <span className="kicker mb-0.5 block opacity-60">
                Filed here because
              </span>
              {thread.reason}
              {thread.confidence !== null &&
                ` (${Math.round(thread.confidence * 100)}% confident)`}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
