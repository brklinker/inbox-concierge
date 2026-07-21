"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, senderName } from "@/lib/format";
import type { ApiBucket, ApiThread } from "@/lib/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

interface LabeledThread extends ApiThread {
  goldLabel?: string | null;
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function LabelMode() {
  const [threads, setThreads] = useState<LabeledThread[] | null>(null);
  const [buckets, setBuckets] = useState<ApiBucket[]>([]);
  const [index, setIndex] = useState(0);
  const [labeledCount, setLabeledCount] = useState(0);
  // Stack of {index, previousLabel} for undo.
  const history = useRef<{ index: number; previous: string | null }[]>([]);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/threads");
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to load threads");
        return;
      }
      // Random order so the gold set isn't all recent mail. All buckets get
      // a key, custom ones included — gold labels must be able to say
      // "Recruiters", or the eval grades correct predictions as misses.
      setThreads(shuffle(data.threads as LabeledThread[]));
      setBuckets((data.buckets as ApiBucket[]).slice(0, 9));
    })();
  }, []);

  const save = useCallback(
    async (threadId: string, goldLabel: string | null) => {
      const res = await fetch("/api/label", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, goldLabel }),
      });
      if (!res.ok) toast.error("Failed to save label");
    },
    [],
  );

  useEffect(() => {
    if (!threads) return;
    const onKey = (e: KeyboardEvent) => {
      const current = threads[index];
      const digit = Number(e.key);
      if (digit >= 1 && digit <= buckets.length && current) {
        const bucket = buckets[digit - 1];
        history.current.push({
          index,
          previous: current.goldLabel ?? null,
        });
        setThreads((prev) => {
          if (!prev) return prev;
          const next = [...prev];
          next[index] = { ...current, goldLabel: bucket.name };
          return next;
        });
        if (!current.goldLabel) setLabeledCount((c) => c + 1);
        save(current.id, bucket.name);
        setIndex((i) => Math.min(i + 1, threads.length - 1));
      } else if (e.key === "s" || e.key === "ArrowRight") {
        setIndex((i) => Math.min(i + 1, threads.length - 1));
      } else if (e.key === "ArrowLeft") {
        setIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "u") {
        const last = history.current.pop();
        if (!last) return;
        const t = threads[last.index];
        setThreads((prev) => {
          if (!prev) return prev;
          const next = [...prev];
          next[last.index] = { ...t, goldLabel: last.previous };
          return next;
        });
        if (last.previous === null) setLabeledCount((c) => Math.max(0, c - 1));
        save(t.id, last.previous);
        setIndex(last.index);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [threads, index, buckets, save]);

  if (!threads) {
    return (
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-16">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-40 w-full" />
      </main>
    );
  }

  const current = threads[index];

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-16">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>Labeling mode (hidden route)</span>
        <span>
          {index + 1}/{threads.length} · {labeledCount} labeled
        </span>
      </div>

      {current ? (
        <Card>
          <CardContent className="space-y-2 pt-6">
            <div className="flex items-baseline justify-between gap-4">
              <span className="font-medium">{senderName(current.sender)}</span>
              <span className="text-xs text-muted-foreground">
                {formatDate(current.internalDate)}
              </span>
            </div>
            <p className="font-medium">{current.subject || "(no subject)"}</p>
            <p className="text-sm text-muted-foreground">{current.snippet}</p>
            {current.goldLabel && (
              <Badge variant="secondary">gold: {current.goldLabel}</Badge>
            )}
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground">No threads loaded.</p>
      )}

      <div className="space-y-1 text-sm">
        {buckets.map((b, i) => (
          <p key={b.id}>
            <kbd className="rounded border px-1">{i + 1}</kbd> {b.name}
          </p>
        ))}
        <p className="pt-2 text-muted-foreground">
          <kbd className="rounded border px-1">s</kbd> skip ·{" "}
          <kbd className="rounded border px-1">u</kbd> undo ·{" "}
          <kbd className="rounded border px-1">←</kbd>
          <kbd className="rounded border px-1">→</kbd> navigate
        </p>
      </div>
    </main>
  );
}
