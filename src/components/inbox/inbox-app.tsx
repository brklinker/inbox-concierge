"use client";

import { BucketCreateDialog } from "./bucket-create-dialog";
import { BucketScanRibbon, type ScanState } from "./bucket-scan-ribbon";
import { BucketSuggestDialog, type BucketSuggestionItem } from "./bucket-suggest-dialog";
import { ClassificationProgress, type ClassifyProgress } from "./classification-progress";
import { ConsistencyIndicator, type ReviewSummary } from "./consistency-indicator";
import { InboxList } from "./inbox-list";
import { ALL_TAB, SectionsNav, UNSORTED_TAB } from "./sections-nav";
import { SettingsDialog } from "./settings-dialog";
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
import { bucketTone } from "@/lib/bucket-tones";
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

function Masthead({
  userEmail,
  onSettings,
}: {
  userEmail?: string;
  onSettings?: () => void;
}) {
  return (
    <>
      <header className="flex items-end gap-4 border-b-[3px] border-ink pb-2 pt-6">
        <div className="mr-auto">
          <p className="kicker text-press-700">
            A calmer inbox · sorted for you, live
          </p>
          <h1 className="mt-0.5 text-[44px] font-semibold leading-none tracking-tight">
            Inbox Concierge
          </h1>
        </div>
        {userEmail && (
          <span className="pb-1.5 text-[13px] text-muted-foreground max-md:hidden">
            {userEmail}
          </span>
        )}
        {onSettings && (
          <Button
            variant="outline"
            size="sm"
            className="mb-1 rounded-[2px]"
            onClick={onSettings}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5 5l2.1 2.1M16.9 16.9L19 19M19 5l-2.1 2.1M7.1 16.9L5 19" />
            </svg>
            Settings
          </Button>
        )}
      </header>
      <div className="mt-px h-px bg-ink" />
    </>
  );
}

export function InboxApp({ userEmail }: { userEmail: string }) {
  const [threads, setThreads] = useState<Map<string, ApiThread> | null>(null);
  const [bucketList, setBucketList] = useState<ApiBucket[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ClassifyProgress>(IDLE_PROGRESS);
  const [review, setReview] = useState<ReviewSummary | null>(null);
  const [reviewDismissed, setReviewDismissed] = useState(false);
  const [scan, setScan] = useState<ScanState | null>(null);
  const [active, setActive] = useState<string>(ALL_TAB);
  const [refreshing, setRefreshing] = useState(false);
  const [confirmReclassify, setConfirmReclassify] = useState(false);
  const [bucketDialogOpen, setBucketDialogOpen] = useState(false);
  const [editBucket, setEditBucket] = useState<ApiBucket | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [preset, setPreset] = useState<BucketSuggestionItem | null>(null);
  const [confirmDeleteBucket, setConfirmDeleteBucket] = useState<ApiBucket | null>(null);
  const [confirmDeleteData, setConfirmDeleteData] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const classifyRunning = useRef(false);
  const hasLoaded = useRef(false);

  const applyResults = useCallback(
    (results: NonNullable<ClassifyEvent["results"]>) => {
      setThreads((prev) => {
        if (!prev) return prev;
        const next = new Map(prev);
        results.forEach((r, i) => {
          const t = next.get(r.id);
          if (t) {
            next.set(r.id, {
              ...t,
              bucketId: r.bucketId,
              confidence: r.confidence,
              reason: r.reason,
              classifiedAt: new Date().toISOString(),
              // Cascade the batch's arrivals instead of landing all at once.
              arrivalDelay: i * 55,
            });
          }
        });
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
      setReviewDismissed(false);
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
    [classify],
  );

  useEffect(() => {
    // Mount-time fetch; all setState happens after the awaited response.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(false);
  }, [load]);

  const reclassifyAll = async () => {
    setConfirmReclassify(false);
    setRefreshing(true);
    setScan(null);
    const fresh = await load(true);
    if (fresh) classify(fresh.map((t) => t.id), true);
  };

  const createBucket = async (name: string, description: string) => {
    setBucketDialogOpen(false);
    setPreset(null);
    setScan({ phase: "scanning", name });
    try {
      const res = await fetch("/api/buckets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Create failed (${res.status})`);
      setBucketList((prev) => [...prev, data.bucket]);
      applyResults(data.moved);
      setActive(data.bucket.id);
      setScan({
        phase: "done",
        name: data.bucket.name,
        scanned: data.scanned,
        evaluated: data.evaluated,
        moved: data.moved.length,
        usedFallback: data.usedFallback,
      });
    } catch (e) {
      setScan(null);
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const saveBucket = async (bucket: ApiBucket, name: string, description: string) => {
    setBucketDialogOpen(false);
    try {
      const res = await fetch(`/api/buckets/${bucket.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Save failed (${res.status})`);
      setBucketList((prev) => prev.map((b) => (b.id === data.bucket.id ? data.bucket : b)));
      toast.success(`Updated "${data.bucket.name}".`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const deleteBucket = async (bucket: ApiBucket) => {
    setConfirmDeleteBucket(null);
    // The delete endpoint re-sorts the bucket's threads with an LLM pass
    // before responding, so remove the bucket optimistically and show its
    // threads as sorting; roll both back if the request fails.
    const prevBuckets = bucketList;
    const orphanIds = threads
      ? [...threads.values()].filter((t) => t.bucketId === bucket.id).map((t) => t.id)
      : [];
    setBucketList((prev) => prev.filter((b) => b.id !== bucket.id));
    setActive((cur) => (cur === bucket.id ? ALL_TAB : cur));
    setThreads((prev) => {
      if (!prev) return prev;
      const next = new Map(prev);
      for (const id of orphanIds) {
        const t = next.get(id);
        if (t) next.set(id, { ...t, bucketId: null });
      }
      return next;
    });
    try {
      const res = await fetch(`/api/buckets/${bucket.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Delete failed (${res.status})`);
      applyResults(data.reassigned ?? []);
      toast.success(`Deleted "${bucket.name}" — ${data.reassigned.length} threads re-sorted.`);
    } catch (e) {
      setBucketList(prevBuckets);
      setThreads((prev) => {
        if (!prev) return prev;
        const next = new Map(prev);
        for (const id of orphanIds) {
          const t = next.get(id);
          if (t) next.set(id, { ...t, bucketId: bucket.id });
        }
        return next;
      });
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const moveThread = async (thread: ApiThread, bucketId: string) => {
    try {
      const res = await fetch(`/api/threads/${thread.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bucketId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Move failed (${res.status})`);
      applyResults([data]);
      toast.success(`Moved to ${data.bucket} — the concierge will learn from this.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  if (loadError) {
    return (
      <div className="mx-auto w-full max-w-[1200px] px-6 pb-10">
        <Masthead />
        <div className="ribbon mt-8" style={{ borderTopColor: "var(--press2)" }}>
          <div className="text-lg font-semibold">Couldn&apos;t load your inbox</div>
          <p className="mt-1 text-sm text-muted-foreground">{loadError}</p>
          <div className="mt-4 flex gap-2">
            <Button
              className="rounded-[2px]"
              onClick={() => {
                setLoadError(null);
                load(false);
              }}
            >
              Retry
            </Button>
            <Button variant="outline" className="rounded-[2px]" onClick={() => signOut()}>
              Sign out
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (threads === null) {
    return (
      <div className="mx-auto w-full max-w-[1200px] px-6 pb-10">
        <Masthead userEmail={userEmail} />
        <div className="mt-8 flex gap-10">
          <div className="w-[236px] flex-none space-y-2 max-lg:hidden">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-9 w-full rounded-[2px]" />
            ))}
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <Skeleton className="h-8 w-56 rounded-[2px]" />
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-[2px]" />
            ))}
          </div>
        </div>
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
  const tones = bucketList.map((b, i) => ({ bucket: b, tone: bucketTone(b.name, i) }));
  const bucketNameById = new Map(bucketList.map((b) => [b.id, b.name]));
  const badgeClassById = new Map(tones.map(({ bucket, tone }) => [bucket.id, tone.badgeClass]));
  const moveTargets = tones.map(({ bucket, tone }) => ({
    id: bucket.id,
    name: bucket.name,
    dot: tone.dot,
  }));

  const sections = [
    {
      id: ALL_TAB,
      name: "All threads",
      dot: "var(--ink)",
      count: allThreads.length,
      manageable: false,
    },
    ...tones.map(({ bucket, tone }) => ({
      id: bucket.id,
      name: bucket.name,
      dot: tone.dot,
      count: counts.get(bucket.id) ?? 0,
      manageable: true,
      bucket,
    })),
    ...(unsortedCount > 0
      ? [
          {
            id: UNSORTED_TAB,
            name: "Unsorted",
            dot: "var(--color-neutral-400)",
            count: unsortedCount,
            manageable: false,
          },
        ]
      : []),
  ];

  // The Unsorted section disappears once everything is classified; don't
  // leave the user staring at its empty filter.
  const effectiveActive =
    active === UNSORTED_TAB && unsortedCount === 0 ? ALL_TAB : active;
  const visible =
    effectiveActive === ALL_TAB
      ? allThreads
      : effectiveActive === UNSORTED_TAB
        ? allThreads.filter((t) => !t.bucketId)
        : allThreads.filter((t) => t.bucketId === effectiveActive);
  const activeBucket = bucketList.find((b) => b.id === effectiveActive) ?? null;
  const activeName =
    effectiveActive === ALL_TAB
      ? "All threads"
      : effectiveActive === UNSORTED_TAB
        ? "Unsorted"
        : (activeBucket?.name ?? "All threads");
  const isClassifying =
    progress.phase === "classifying" || progress.phase === "reviewing";

  return (
    <div className="mx-auto w-full max-w-[1200px] px-6 pb-10">
      <Masthead userEmail={userEmail} onSettings={() => setSettingsOpen(true)} />

      <div className="mt-8 flex items-start gap-10 max-lg:flex-col max-lg:gap-6">
        <SectionsNav
          items={sections}
          active={effectiveActive}
          onSelect={setActive}
          onEdit={(b) => {
            setPreset(null);
            setEditBucket(b);
            setBucketDialogOpen(true);
          }}
          onDelete={(b) => setConfirmDeleteBucket(b)}
        />

        <main className="min-w-0 flex-1">
          <div className="flex items-baseline gap-4 pb-4">
            <h2 className="text-[26px] font-semibold leading-tight">{activeName}</h2>
            <span className="text-sm text-muted-foreground">
              {visible.length} thread{visible.length === 1 ? "" : "s"}
            </span>
            <div className="ml-auto flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="rounded-[2px] text-press"
                onClick={() => setSuggestOpen(true)}
              >
                Suggest
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="rounded-[2px]"
                onClick={() => {
                  setEditBucket(null);
                  setPreset(null);
                  setBucketDialogOpen(true);
                }}
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
                New bucket
              </Button>
              <Button
                size="sm"
                className="rounded-[2px]"
                disabled={refreshing || isClassifying}
                onClick={() => {
                  setRefreshing(true);
                  load(true);
                }}
              >
                {isClassifying ? "Sorting…" : refreshing ? "Checking…" : "Check new mail"}
              </Button>
            </div>
          </div>

          <BucketScanRibbon scan={scan} onDismiss={() => setScan(null)} />
          <ClassificationProgress progress={progress} />
          {!isClassifying && !scan && !reviewDismissed && (
            <ConsistencyIndicator
              summary={review}
              resolveThread={(id) => threads.get(id)}
              onJumpToBucket={(bucketId) => setActive(bucketId)}
              onDismiss={() => setReviewDismissed(true)}
            />
          )}

          <InboxList
            threads={visible}
            bucketNameById={bucketNameById}
            badgeClassById={badgeClassById}
            moveTargets={moveTargets}
            isClassifying={isClassifying}
            onMove={moveThread}
            emptyMessage={
              effectiveActive === ALL_TAB
                ? "No threads in your inbox."
                : isClassifying
                  ? "Still sorting — threads land here as they're filed."
                  : "Nothing matched this bucket in the last run."
            }
          />
        </main>
      </div>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        userEmail={userEmail}
        mailActionsDisabled={refreshing || isClassifying}
        onCheckNewMail={() => {
          setSettingsOpen(false);
          setRefreshing(true);
          load(true);
        }}
        onResort={() => {
          setSettingsOpen(false);
          setConfirmReclassify(true);
        }}
        onDeleteData={() => {
          setSettingsOpen(false);
          setConfirmDeleteData(true);
        }}
      />

      <BucketSuggestDialog
        open={suggestOpen}
        onOpenChange={setSuggestOpen}
        onPick={(s) => {
          setSuggestOpen(false);
          setEditBucket(null);
          setPreset(s);
          setBucketDialogOpen(true);
        }}
      />

      <BucketCreateDialog
        key={editBucket?.id ?? preset?.name ?? "create"}
        open={bucketDialogOpen}
        onOpenChange={setBucketDialogOpen}
        editBucket={editBucket}
        preset={preset}
        onSubmit={(name, description) => {
          if (editBucket) saveBucket(editBucket, name, description);
          else createBucket(name, description);
        }}
      />

      <Dialog
        open={!!confirmDeleteBucket}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteBucket(null);
        }}
      >
        <DialogContent className="bg-surface sm:rounded-lg">
          <DialogHeader>
            <DialogTitle className="text-xl">
              Delete &quot;{confirmDeleteBucket?.name}&quot;?
            </DialogTitle>
            <DialogDescription>
              Its {confirmDeleteBucket ? (counts.get(confirmDeleteBucket.id) ?? 0) : 0}{" "}
              threads re-sort into your remaining buckets. This can&apos;t be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              className="rounded-[2px]"
              onClick={() => setConfirmDeleteBucket(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="rounded-[2px]"
              onClick={() => confirmDeleteBucket && deleteBucket(confirmDeleteBucket)}
            >
              Delete & re-sort
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDeleteData} onOpenChange={setConfirmDeleteData}>
        <DialogContent className="bg-surface sm:rounded-lg">
          <DialogHeader>
            <DialogTitle className="text-xl">
              Delete everything stored for this account?
            </DialogTitle>
            <DialogDescription>
              Removes everything stored for this account and signs you out.
              Signing in again starts fresh. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              className="rounded-[2px]"
              onClick={() => setConfirmDeleteData(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="rounded-[2px]"
              onClick={async () => {
                try {
                  const res = await fetch("/api/me", { method: "DELETE" });
                  if (!res.ok) throw new Error(`Delete failed (${res.status})`);
                  await signOut();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              Delete & sign out
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmReclassify} onOpenChange={setConfirmReclassify}>
        <DialogContent className="bg-surface sm:rounded-lg">
          <DialogHeader>
            <DialogTitle className="text-xl">Re-sort everything?</DialogTitle>
            <DialogDescription>
              Reclassifies all {allThreads.length} threads from scratch (~30
              seconds). Your own re-files stay put.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              className="rounded-[2px]"
              onClick={() => setConfirmReclassify(false)}
            >
              Cancel
            </Button>
            <Button className="rounded-[2px]" onClick={reclassifyAll}>
              Re-sort
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
