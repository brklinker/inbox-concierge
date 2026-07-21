"use client";

export type ScanState =
  | { phase: "scanning"; name: string }
  | {
      phase: "done";
      name: string;
      scanned: number;
      evaluated: number;
      moved: number;
      usedFallback: boolean;
    };

function Stat({
  value,
  label,
  accent,
  delay,
}: {
  value: number;
  label: string;
  accent?: boolean;
  delay?: string;
}) {
  return (
    <span className="flex items-baseline gap-2">
      <span
        className={`anim-pop text-[40px] font-semibold leading-none ${accent ? "text-press-700" : ""}`}
        style={delay ? { animationDelay: delay } : undefined}
      >
        {value}
      </span>
      <span className="text-[13px] text-muted-foreground">{label}</span>
    </span>
  );
}

export function BucketScanRibbon({
  scan,
  onDismiss,
}: {
  scan: ScanState | null;
  onDismiss: () => void;
}) {
  if (!scan) return null;

  if (scan.phase === "scanning") {
    return (
      <div className="ribbon mb-5">
        <div className="flex items-center gap-2.5 text-lg font-semibold">
          <span className="inline-block size-3.5 animate-spin rounded-full border-2 border-press-300 border-t-press" />
          Scanning your inbox against &ldquo;{scan.name}&rdquo;…
        </div>
        <div className="relative mt-3.5 h-1 overflow-hidden rounded-[2px] bg-neutral-200">
          <div className="anim-sweep absolute left-0 top-0 h-full w-[38%] bg-press" />
        </div>
      </div>
    );
  }

  const untouched = scan.scanned - scan.moved;
  return (
    <div
      className="ribbon anim-arrive mb-5"
      style={{ borderTopColor: "var(--press)" }}
    >
      <div className="flex items-start">
        <div className="kicker text-press-700">New bucket · {scan.name}</div>
        <button
          className="ml-auto text-xs text-press-700 underline-offset-2 hover:underline"
          onClick={onDismiss}
        >
          Dismiss
        </button>
      </div>
      <div className="mt-2.5 flex flex-wrap items-baseline gap-x-8 gap-y-1">
        <Stat value={scan.scanned} label="scanned" />
        <Stat value={scan.evaluated} label="evaluated" delay="0.1s" />
        <Stat value={scan.moved} label="moved in" accent delay="0.2s" />
      </div>
      <p className="mb-0 mt-3 max-w-[54ch] text-[15px]">
        {scan.usedFallback
          ? "The description was broad, so every thread was evaluated — still, only the matches moved."
          : `Only the ${scan.moved} matching thread${scan.moved === 1 ? "" : "s"} moved. The other ${untouched} stayed exactly where they were — a new bucket re-files, it never re-sorts your inbox.`}
      </p>
    </div>
  );
}
