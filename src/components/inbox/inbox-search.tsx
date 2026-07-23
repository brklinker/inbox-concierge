"use client";

import { Button } from "@/components/ui/button";
import type { ApiSearchResponse } from "@/lib/types";
import { useState } from "react";

/** The ask-your-inbox query bar. Owns only its input text. */
export function InboxSearch({
  onSearch,
  onClear,
  searching,
  active,
}: {
  onSearch: (query: string) => void;
  onClear: () => void;
  searching: boolean;
  active: boolean;
}) {
  const [text, setText] = useState("");
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = text.trim();
    if (q) onSearch(q);
  };
  return (
    <form onSubmit={submit} className="mb-5 flex items-center gap-2">
      <div className="relative min-w-0 flex-1">
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={200}
          disabled={searching}
          aria-label="Ask your inbox"
          placeholder="Ask your inbox — e.g. “recruiter threads about backend roles”"
          className="h-10 w-full rounded-[2px] border border-border bg-surface pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus:border-press disabled:opacity-60"
        />
      </div>
      <Button
        type="submit"
        size="sm"
        className="h-10 rounded-[2px]"
        disabled={searching || !text.trim()}
      >
        {searching ? "Asking…" : "Ask"}
      </Button>
      {active && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-10 rounded-[2px]"
          onClick={() => {
            setText("");
            onClear();
          }}
        >
          Clear
        </Button>
      )}
    </form>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-[22px] font-semibold leading-none">{value}</span>
      <span className="text-[12px] text-muted-foreground">{label}</span>
    </span>
  );
}

/** The natural-language answer + retrieval counts for an active search. */
export function SearchAnswerRibbon({
  result,
  query,
}: {
  result: ApiSearchResponse;
  query: string;
}) {
  return (
    <div className="ribbon anim-arrive mb-5" style={{ borderTopColor: "var(--press)" }}>
      <div className="kicker text-press-700">Ask your inbox · &ldquo;{query}&rdquo;</div>
      <p className="mb-0 mt-2 max-w-[62ch] text-[16px] leading-snug">{result.answer}</p>
      <div className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <Stat value={result.scanned} label="scanned" />
        <Stat value={result.evaluated} label="evaluated" />
        <Stat value={result.matched} label="matched" />
      </div>
    </div>
  );
}
