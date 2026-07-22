import { describe, expect, it } from "vitest";
import { rateLimit } from "../rate-limit";

describe("rateLimit", () => {
  it("allows max hits in the window, then blocks with a retry hint", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) {
      expect(rateLimit("a", 3, 60_000, t0 + i * 1000)).toEqual({ ok: true });
    }
    const blocked = rateLimit("a", 3, 60_000, t0 + 3000);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      // Oldest hit at t0 leaves the window at t0+60s; 57s remain.
      expect(blocked.retryAfterSeconds).toBe(57);
    }
  });

  it("frees capacity as old hits slide out of the window", () => {
    const t0 = 2_000_000;
    rateLimit("b", 2, 60_000, t0);
    rateLimit("b", 2, 60_000, t0 + 1000);
    expect(rateLimit("b", 2, 60_000, t0 + 2000).ok).toBe(false);
    expect(rateLimit("b", 2, 60_000, t0 + 61_000).ok).toBe(true);
  });

  it("tracks keys independently", () => {
    const t0 = 3_000_000;
    expect(rateLimit("c1", 1, 60_000, t0).ok).toBe(true);
    expect(rateLimit("c1", 1, 60_000, t0 + 1).ok).toBe(false);
    expect(rateLimit("c2", 1, 60_000, t0 + 1).ok).toBe(true);
  });
});
