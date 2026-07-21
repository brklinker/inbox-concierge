"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useEffect, useState } from "react";

export interface BucketSuggestionItem {
  name: string;
  description: string;
  size: number;
  exampleSubjects: string[];
}

function Suggestions({
  onPick,
}: {
  onPick: (s: BucketSuggestionItem) => void;
}) {
  const [suggestions, setSuggestions] = useState<BucketSuggestionItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/buckets/suggest", { method: "POST" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `Suggest failed (${res.status})`);
        if (!cancelled) setSuggestions(data.suggestions);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (suggestions === null) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Clustering your threads and looking for themes…
        </p>
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }
  if (suggestions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No new buckets to suggest — your current set already covers the themes
        in this inbox.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {suggestions.map((s) => (
        <button
          key={s.name}
          className="w-full rounded-[2px] border bg-background p-3 text-left hover:bg-accent"
          onClick={() => onPick(s)}
        >
          <span className="text-sm font-medium">
            {s.name}{" "}
            <span className="font-normal text-muted-foreground">
              · ~{s.size} threads
            </span>
          </span>
          <span className="mt-1 block text-xs text-muted-foreground">
            {s.description}
          </span>
          {s.exampleSubjects.length > 0 && (
            <span className="mt-1 block truncate text-xs text-muted-foreground">
              e.g. {s.exampleSubjects.join(" · ")}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export function BucketSuggestDialog({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (s: BucketSuggestionItem) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface sm:rounded-lg">
        <DialogHeader>
          <DialogTitle className="text-xl">Suggested buckets</DialogTitle>
          <DialogDescription>
            Themes found by clustering your threads&apos; embeddings. Pick one
            to prefill it — you can edit before creating.
          </DialogDescription>
        </DialogHeader>
        {open && <Suggestions onPick={onPick} />}
      </DialogContent>
    </Dialog>
  );
}
