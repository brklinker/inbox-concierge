import { afterEach, describe, expect, it, vi } from "vitest";
import { selectCandidates } from "../candidates";
import { findInconsistent } from "../consistency";
import { refreshGoogleAccessToken } from "../refresh-token";

const OPTS = { neighbors: 3, disagreement: 0.6, confidence: 0.7 };

function member(id: string, bucketName: string, extra: Partial<Parameters<typeof findInconsistent>[0][number]> = {}) {
  return {
    id,
    embedding: [1, 0],
    bucketName,
    confidence: 0.9,
    corrected: false,
    ...extra,
  };
}

describe("findInconsistent", () => {
  const disagreeingNeighbors = [
    member("n1", "A"),
    member("n2", "A"),
    member("n3", "A"),
  ];

  it("flags a low-confidence thread whose neighbors mostly disagree", () => {
    const pool = [...disagreeingNeighbors, member("x", "B", { confidence: 0.5 })];
    expect(findInconsistent(pool, new Set(["x"]), OPTS)).toEqual([
      { id: "x", majority: "A" },
    ]);
  });

  it("trusts high confidence even when neighbors disagree", () => {
    const pool = [...disagreeingNeighbors, member("x", "B", { confidence: 0.9 })];
    expect(findInconsistent(pool, new Set(["x"]), OPTS)).toEqual([]);
  });

  it("never second-guesses corrected threads", () => {
    const pool = [
      ...disagreeingNeighbors,
      member("x", "B", { confidence: 0.5, corrected: true }),
    ];
    expect(findInconsistent(pool, new Set(["x"]), OPTS)).toEqual([]);
  });

  it("only reviews threads from the current run", () => {
    const pool = [...disagreeingNeighbors, member("x", "B", { confidence: 0.5 })];
    expect(findInconsistent(pool, new Set(["n1"]), OPTS)).toEqual([]);
  });
});

describe("selectCandidates", () => {
  const OPTS = { k: 2, confidenceFloor: 0.6, similarityFloor: 0.25 };
  const near = (id: string, extra = {}) => ({
    id,
    embedding: [1, 0],
    confidence: 0.9,
    corrected: false,
    ...extra,
  });
  const far = (id: string, extra = {}) => ({
    id,
    embedding: [0, 1],
    confidence: 0.9,
    corrected: false,
    ...extra,
  });

  it("takes top-k by similarity plus low-confidence threads", () => {
    const { ids, usedFallback } = selectCandidates(
      [near("a"), near("b"), far("c"), far("low", { confidence: 0.3 })],
      [1, 0],
      OPTS,
    );
    expect(usedFallback).toBe(false);
    expect([...ids].sort()).toEqual(["a", "b", "low"]);
  });

  it("falls back to everything when even the best match is weak", () => {
    const { ids, usedFallback } = selectCandidates(
      [far("a"), far("b"), far("c")],
      [1, 0],
      OPTS,
    );
    expect(usedFallback).toBe(true);
    expect(ids.size).toBe(3);
  });

  it("never selects corrected threads, in either mode", () => {
    const strong = selectCandidates(
      [near("a"), near("corrected", { corrected: true })],
      [1, 0],
      OPTS,
    );
    expect(strong.ids.has("corrected")).toBe(false);
    const fallback = selectCandidates(
      [far("a"), far("corrected", { corrected: true })],
      [1, 0],
      OPTS,
    );
    expect(fallback.usedFallback).toBe(true);
    expect(fallback.ids.has("corrected")).toBe(false);
  });
});

describe("refreshGoogleAccessToken", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns fresh credentials with a computed expiry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ access_token: "new", expires_in: 3600 }),
          { status: 200 },
        ),
      ),
    );
    const before = Math.floor(Date.now() / 1000);
    const out = await refreshGoogleAccessToken("refresh");
    expect(out.access_token).toBe("new");
    expect(out.refresh_token).toBeUndefined();
    expect(out.expires_at).toBeGreaterThanOrEqual(before + 3599);
  });

  it("throws on a rejected refresh so the session can surface the error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
      ),
    );
    await expect(refreshGoogleAccessToken("refresh")).rejects.toThrow(
      "Token refresh failed (400)",
    );
  });
});
