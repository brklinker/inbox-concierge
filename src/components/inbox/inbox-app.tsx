"use client";

import { BucketCreateDialog, type BucketCreateResult } from "./bucket-create-dialog";
import { ALL_TAB, BucketTabs, UNSORTED_TAB } from "./bucket-tabs";
import { ClassificationProgress, type ClassifyProgress } from "./classification-progress";
import { ConsistencyIndicator, type ReviewSummary } from "./consistency-indicator";
import { InboxList } from "./inbox-list";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { readSSE } from "@/lib/sse-client";
import type { ApiBucket, ApiThread, ClassifyEvent } from "@/lib/types";
import { signOut } from "next-auth/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

const IDLE_PROGRESS: ClassifyProgress = {
  phase: "idle",
  total: 0,
  batches: 0,
  completed: 0,
  flagged: 0,
};

export function InboxApp({ userEmail }: { userEmail: string }) {
  const [threads, setThreads] = useState<Map<string, ApiThread> | null>(null);
  const [bucketList, setBucketList] = useState<ApiBucket[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ClassifyProgress>(IDLE_PROGRESS);
  const [review, setReview] = useState<ReviewSummary | null>(null);
  const [active, setActive] = useState<string>(ALL_TAB);
  const [refreshing, setRefreshing] = useState(false);
  const [confirmReclassify, setConfirmReclassify] = useState(false);
  const [bucketDialogOpen, setBucketDialogOpen] = useState(false);
  const [editBucket, setEditBucket] = useState<ApiBucket | null>(null);
  const classifyRunning = useRef(false);
  const hasLoaded = useRef(false);

  const applyResults = useCallback(
    (results: NonNullable<ClassifyEvent["results"]>) => {
      setThreads((prev) => {
        if (!prev) return prev;
        const next = new Map(prev);
        for (const r of results) {
          const t = next.get(r.id);
          if (t) {
            next.set(r.id, {
              ...t,
              bucketId: r.bucketId,
              confidence: r.confidence,
              reason: r.reason,
              classifiedAt: new Date().toISOString(),
            });
          }
        }
        return next;
      });
    },
    [],
  );

  const classify = useCallback(
    async (threadIds: string[], force: boolean) => {
      if (classifyRunning.current || threadIds.length === 0) return;
      classifyRunning.current = true;
      setReview(null);
      setProgress({ ...IDLE_PROGRESS, phase: "classifying", total: threadIds.length });
      try {
        const res = await fetch("/api/classify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ threadIds, force }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? `Classification failed (${res.status})`);
        }
        for await (const event of readSSE<ClassifyEvent>(res)) {
          if (event.type === "start") {
            setProgress((p) => ({
              ...p,
              total: event.total ?? p.total,
              batches: event.batches ?? 0,
            }));
          } else if (event.type === "batch") {
            applyResults(event.results ?? []);
            setProgress((p) => ({ ...p, completed: event.completed ?? p.completed }));
          } else if (event.type === "review_start") {
            setProgress((p) => ({
              ...p,
              phase: "reviewing",
              flagged: event.flagged ?? 0,
            }));
          } else if (event.type === "done") {
            applyResults(event.corrections ?? []);
            setReview({
              reviewed: event.reviewed ?? 0,
              corrections: event.corrections ?? [],
            });
            setProgress((p) => ({ ...p, phase: "done" }));
          } else if (event.type === "error") {
            throw new Error(event.message);
          }
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setProgress((p) => ({ ...p, phase: "error", error: message }));
        toast.error(`Classification failed: ${message}`);
      } finally {
        classifyRunning.current = false;
      }
    },
    [applyResults],
  );

  const load = useCallback(
    async (refresh: boolean) => {
      try {
        const res = await fetch(`/api/threads${refresh ? "?refresh=1" : ""}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `Fetch failed (${res.status})`);
        hasLoaded.current = true;
        setLoadError(null);
        const map = new Map<string, ApiThread>(
          (data.threads as ApiThread[]).map((t) => [t.id, t]),
        );
        setThreads(map);
        setBucketList(data.buckets);
        const unclassified = (data.threads as ApiThread[])
          .filter((t) => !t.classifiedAt)
          .map((t) => t.id);
        if (unclassified.length > 0) classify(unclassified, false);
        return data.threads as ApiThread[];
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (!hasLoaded.current) setLoadError(message);
        else toast.error(message);
        return null;
      } finally {
        setRefreshing(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [classify],
  );

  useEffect(() => {
    // Mount-time fetch; all setState happens after the awaited response.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reclassifyAll = async () => {
    setConfirmReclassify(false);
    setRefreshing(true);
    const fresh = await load(true);
    if (fresh) classify(fresh.map((t) => t.id), true);
  };

  const handleBucketCreated = (result: BucketCreateResult) => {
    setBucketList((prev) => [...prev, result.bucket]);
    setThreads((prev) => {
      if (!prev) return prev;
      const next = new Map(prev);
      for (const m of result.moved) {
        const t = next.get(m.id);
        if (t) {
          next.set(m.id, {
            ...t,
            bucketId: m.bucketId,
            confidence: m.confidence,
            reason: m.reason,
          });
        }
      }
      return next;
    });
    setActive(result.bucket.id);
  };

  const deleteBucket = async (bucket: ApiBucket) => {
    try {
      const res = await fetch(`/api/buckets/${bucket.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Delete failed (${res.status})`);
      setBucketList((prev) => prev.filter((b) => b.id !== bucket.id));
      if (active === bucket.id) setActive(ALL_TAB);
      applyResults(data.reassigned ?? []);
      toast.success(
        `Deleted "${bucket.name}" — ${data.reassigned.length} threads re-sorted`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  if (loadError) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-16 text-center">
        <p className="text-sm text-destructive">Couldn&apos;t load your inbox: {loadError}</p>
        <div className="flex justify-center gap-2">
          <Button
            onClick={() => {
              setLoadError(null);
              load(false);
            }}
          >
            Retry
          </Button>
          <Button variant="outline" onClick={() => signOut()}>
            Sign out
          </Button>
        </div>
      </div>
    );
  }

  if (threads === null) {
    return (
      <div className="mx-auto max-w-5xl space-y-3 px-4 py-8">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-8 w-full" />
        {Array.from({ length: 10 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    );
  }

  const allThreads = [...threads.values()].sort((a, b) =>
    (b.internalDate ?? "").localeCompare(a.internalDate ?? ""),
  );
  const counts = new Map<string, number>();
  let unsortedCount = 0;
  for (const t of allThreads) {
    if (t.bucketId) counts.set(t.bucketId, (counts.get(t.bucketId) ?? 0) + 1);
    else unsortedCount += 1;
  }
  const bucketNameById = new Map(bucketList.map((b) => [b.id, b.name]));
  const visible =
    active === ALL_TAB
      ? allThreads
      : active === UNSORTED_TAB
        ? allThreads.filter((t) => !t.bucketId)
        : allThreads.filter((t) => t.bucketId === active);
  const activeBucket = bucketList.find((b) => b.id === active) ?? null;
  const isClassifying =
    progress.phase === "classifying" || progress.phase === "reviewing";

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-8">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">Inbox Concierge</h1>
          <p className="text-xs text-muted-foreground">{userEmail}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={refreshing || isClassifying}
            onClick={() => {
              setRefreshing(true);
              load(true);
            }}
          >
            {refreshing ? "Checking…" : "Check new mail"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={refreshing || isClassifying}
            onClick={() => setConfirmReclassify(true)}
          >
            Re-sort everything
          </Button>
          <Button size="sm" variant="ghost" onClick={() => signOut()}>
            Sign out
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <BucketTabs
          buckets={bucketList}
          counts={counts}
          unsortedCount={unsortedCount}
          totalCount={allThreads.length}
          active={active}
          onSelect={setActive}
        />
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setEditBucket(null);
            setBucketDialogOpen(true);
          }}
        >
          + New bucket
        </Button>
      </div>

      <div className="flex min-h-6 items-center gap-4">
        <ClassificationProgress progress={progress} />
        {!isClassifying && <ConsistencyIndicator summary={review} />}
        {activeBucket && !activeBucket.isDefault && (
          <span className="flex gap-2 text-xs">
            <button
              className="text-muted-foreground underline"
              onClick={() => {
                setEditBucket(activeBucket);
                setBucketDialogOpen(true);
              }}
            >
              Edit
            </button>
            <button
              className="text-destructive underline"
              onClick={() => deleteBucket(activeBucket)}
            >
              Delete
            </button>
          </span>
        )}
      </div>

      {activeBucket?.description && (
        <p className="text-xs text-muted-foreground">{activeBucket.description}</p>
      )}

      <div className="rounded-md border">
        <InboxList
          threads={visible}
          bucketNameById={bucketNameById}
          showBucket={active === ALL_TAB || active === UNSORTED_TAB}
          isClassifying={isClassifying}
          emptyMessage={
            active === ALL_TAB
              ? "No threads in your inbox."
              : isClassifying
                ? "Nothing here yet — still sorting."
                : "No threads in this bucket."
          }
        />
      </div>

      <BucketCreateDialog
        open={bucketDialogOpen}
        onOpenChange={setBucketDialogOpen}
        editBucket={editBucket}
        onCreated={handleBucketCreated}
        onRenamed={(bucket) =>
          setBucketList((prev) => prev.map((b) => (b.id === bucket.id ? bucket : b)))
        }
      />

      <Dialog open={confirmReclassify} onOpenChange={setConfirmReclassify}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Re-sort everything?</DialogTitle>
            <DialogDescription>
              This refetches your inbox and reclassifies all {allThreads.length}{" "}
              threads from scratch. It takes about half a minute and costs real
              LLM calls — usually only needed after changing buckets.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmReclassify(false)}>
              Cancel
            </Button>
            <Button onClick={reclassifyAll}>Re-sort</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
