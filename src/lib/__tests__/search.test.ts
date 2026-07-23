import { describe, expect, it } from "vitest";
import { selectSearchCandidates } from "../search";

const OPTS = { k: 2, similarityFloor: 0.2 };

describe("selectSearchCandidates", () => {
  const pool = [
    { id: "a", embedding: [1, 0] },
    { id: "b", embedding: [0.6, 0.8] },
    { id: "c", embedding: [0, 1] },
  ];

  it("returns the top-k neighbours ranked by similarity", () => {
    const { neighbors, belowFloor } = selectSearchCandidates([1, 0], pool, OPTS);
    expect(neighbors.map((n) => n.id)).toEqual(["a", "b"]);
    expect(belowFloor).toBe(false);
  });

  it("flags belowFloor when even the closest thread is unrelated", () => {
    const { neighbors, belowFloor } = selectSearchCandidates(
      [0, 1],
      [{ id: "a", embedding: [1, 0] }],
      OPTS,
    );
    // Best match similarity is 0, under the 0.2 floor.
    expect(neighbors[0].id).toBe("a");
    expect(belowFloor).toBe(true);
  });

  it("treats an empty pool as belowFloor with no neighbours", () => {
    const { neighbors, belowFloor } = selectSearchCandidates([1, 0], [], OPTS);
    expect(neighbors).toEqual([]);
    expect(belowFloor).toBe(true);
  });

  it("never returns more than k candidates", () => {
    const { neighbors } = selectSearchCandidates([1, 0], pool, { ...OPTS, k: 1 });
    expect(neighbors).toHaveLength(1);
    expect(neighbors[0].id).toBe("a");
  });
});
