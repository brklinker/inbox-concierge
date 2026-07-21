"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, senderName } from "@/lib/format";
import type { ApiBucket, ApiThread } from "@/lib/types";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export interface CorrectionResult {
  id: string;
  bucketId: string;
  bucket: string;
  confidence: number;
  reason: string;
}

interface ThreadMessageBody {
  from: string | null;
  date: string | null;
  html: string | null;
  text: string | null;
}

function MessageBody({
  message,
  allowRemote,
}: {
  message: ThreadMessageBody;
  allowRemote: boolean;
}) {
  if (message.html) {
    // Sandboxed frame: no scripts, no same-origin access, links open in a new
    // tab. The injected CSP blocks remote loads (tracking pixels would leak
    // the open event and the reader's IP) unless the user opts in; the
    // referrer meta keeps clicked links from carrying one.
    const csp = allowRemote
      ? "default-src 'none'; img-src * data:; style-src 'unsafe-inline'; font-src *"
      : "default-src 'none'; img-src data:; style-src 'unsafe-inline'";
    return (
      <iframe
        sandbox="allow-popups allow-popups-to-escape-sandbox"
        srcDoc={`<meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><base target="_blank">${message.html}`}
        className="h-[55vh] w-full rounded border bg-white"
        title="Email message"
      />
    );
  }
  if (message.text) {
    return (
      <pre className="max-h-[55vh] overflow-y-auto whitespace-pre-wrap rounded border p-3 font-sans text-sm">
        {message.text}
      </pre>
    );
  }
  return <p className="text-sm text-muted-foreground">(no displayable content)</p>;
}

function ThreadMessages({ threadId }: { threadId: string }) {
  const [messages, setMessages] = useState<ThreadMessageBody[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Off by default and reset per thread (this component remounts per id).
  const [allowRemote, setAllowRemote] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/threads/${threadId}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `Fetch failed (${res.status})`);
        if (!cancelled) setMessages(data.messages);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  if (error) {
    return (
      <p className="text-sm text-destructive">
        Couldn&apos;t load this thread: {error}
      </p>
    );
  }
  if (messages === null) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  const hasHtml = messages.some((m) => m.html);
  return (
    <div className="space-y-2">
      {hasHtml && !allowRemote && (
        <p className="text-xs text-muted-foreground">
          Remote images are blocked so the sender can&apos;t tell you opened
          this.{" "}
          <button className="underline" onClick={() => setAllowRemote(true)}>
            Load images
          </button>
        </p>
      )}
      <div className="max-h-[65vh] space-y-3 overflow-y-auto">
        {messages.map((m, i) => (
          <details key={i} open={i === messages.length - 1}>
            <summary className="cursor-pointer text-sm font-medium">
              {senderName(m.from)}{" "}
              <span className="font-normal text-muted-foreground">
                {formatDate(m.date)}
              </span>
            </summary>
            <div className="mt-2">
              <MessageBody message={m} allowRemote={allowRemote} />
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

function BucketSelect({
  thread,
  buckets,
  onCorrected,
}: {
  thread: ApiThread;
  buckets: ApiBucket[];
  onCorrected: (result: CorrectionResult) => void;
}) {
  const [pending, setPending] = useState(false);

  const move = async (bucketId: string) => {
    if (bucketId === thread.bucketId) return;
    setPending(true);
    try {
      const res = await fetch(`/api/threads/${thread.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bucketId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Move failed (${res.status})`);
      onCorrected(data);
      toast.success(
        `Moved to ${data.bucket} — future sorting will learn from this`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <Select
      value={thread.bucketId ?? undefined}
      onValueChange={move}
      disabled={pending}
    >
      <SelectTrigger size="sm" aria-label="Bucket">
        <SelectValue placeholder="Unsorted" />
      </SelectTrigger>
      <SelectContent>
        {buckets.map((b) => (
          <SelectItem key={b.id} value={b.id}>
            {b.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ThreadViewDialog({
  thread,
  buckets,
  onOpenChange,
  onCorrected,
}: {
  thread: ApiThread | null;
  buckets: ApiBucket[];
  onOpenChange: (open: boolean) => void;
  onCorrected: (result: CorrectionResult) => void;
}) {
  return (
    <Dialog open={!!thread} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        {thread && (
          <>
            <DialogHeader>
              <DialogTitle className="pr-6 text-left">
                {thread.subject || "(no subject)"}
              </DialogTitle>
              <DialogDescription className="flex flex-wrap items-center gap-2 text-left">
                <span>{senderName(thread.sender)}</span>
                <span>·</span>
                <span>{formatDate(thread.internalDate)}</span>
                <BucketSelect
                  thread={thread}
                  buckets={buckets}
                  onCorrected={onCorrected}
                />
                {thread.reason && (
                  <span className="text-xs">— {thread.reason}</span>
                )}
              </DialogDescription>
            </DialogHeader>
            {/* Keyed by thread id so fetch state resets by remount. */}
            <ThreadMessages key={thread.id} threadId={thread.id} />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
