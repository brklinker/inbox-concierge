"use client";

import type { ApiBucket } from "@/lib/types";
import { useState } from "react";

export const ALL_TAB = "all";
export const UNSORTED_TAB = "unsorted";

interface SectionItem {
  id: string;
  name: string;
  dot: string;
  count: number;
  manageable: boolean;
  bucket?: ApiBucket;
}

export function SectionsNav({
  items,
  active,
  onSelect,
  onEdit,
  onDelete,
}: {
  items: SectionItem[];
  active: string;
  onSelect: (id: string) => void;
  onEdit: (bucket: ApiBucket) => void;
  onDelete: (bucket: ApiBucket) => void;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);

  return (
    <nav
      aria-label="Buckets"
      className="sticky top-5 flex w-[236px] flex-none flex-col gap-px max-lg:static max-lg:w-full"
    >
      <div className="kicker px-2.5 pb-1.5 text-muted-foreground">Sections</div>
      {items.map((item) => {
        const isActive = active === item.id;
        return (
          <div
            key={item.id}
            className="relative"
            onMouseEnter={() => setHovered(item.id)}
            onMouseLeave={() =>
              setHovered((h) => (h === item.id ? null : h))
            }
          >
            <button
              onClick={() => {
                onSelect(item.id);
                setMenuFor(null);
              }}
              aria-current={isActive ? "page" : undefined}
              className="flex w-full items-center justify-between gap-2.5 rounded-r-[2px] border-l-[3px] px-2.5 py-2 text-left text-lg font-semibold"
              style={{
                borderLeftColor: isActive ? "var(--press)" : "transparent",
                background: isActive
                  ? "color-mix(in srgb, var(--press) 9%, transparent)"
                  : "transparent",
                color: isActive ? "var(--color-press-800)" : "var(--ink)",
              }}
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <span
                  className="size-2 flex-none rounded-full"
                  style={{ background: item.dot }}
                />
                <span className="truncate">{item.name}</span>
              </span>
              <span
                className="text-base font-semibold"
                style={{
                  color:
                    item.count > 0
                      ? isActive
                        ? "var(--color-press-700)"
                        : "var(--color-neutral-600)"
                      : "var(--color-neutral-400)",
                }}
              >
                {item.count}
              </span>
            </button>
            {item.manageable &&
              item.bucket &&
              (hovered === item.id || menuFor === item.id) && (
                <button
                  aria-label={`Manage ${item.name}`}
                  aria-haspopup="menu"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuFor((m) => (m === item.id ? null : item.id));
                  }}
                  className="absolute right-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-[2px] bg-background text-neutral-600 hover:text-ink"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="5" cy="12" r="1.7" />
                    <circle cx="12" cy="12" r="1.7" />
                    <circle cx="19" cy="12" r="1.7" />
                  </svg>
                </button>
              )}
            {menuFor === item.id && item.bucket && (
              <>
                <div
                  className="fixed inset-0 z-50"
                  onClick={() => setMenuFor(null)}
                />
                <div
                  role="menu"
                  className="absolute right-0 top-full z-[60] mt-0.5 flex min-w-[168px] flex-col rounded-[3px] border border-neutral-400 p-1"
                  style={{
                    background: "var(--paper, #f3f2f2)",
                    boxShadow: "0 12px 32px rgba(45, 43, 43, 0.22)",
                  }}
                >
                  <button
                    role="menuitem"
                    className="rounded-[2px] px-3 py-2 text-left text-sm hover:bg-accent"
                    onClick={() => {
                      setMenuFor(null);
                      onEdit(item.bucket!);
                    }}
                  >
                    Edit criteria
                  </button>
                  {!item.bucket.isDefault && (
                    <button
                      role="menuitem"
                      className="rounded-[2px] px-3 py-2 text-left text-sm text-press2-700 hover:bg-accent"
                      onClick={() => {
                        setMenuFor(null);
                        onDelete(item.bucket!);
                      }}
                    >
                      Delete bucket
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        );
      })}
    </nav>
  );
}
