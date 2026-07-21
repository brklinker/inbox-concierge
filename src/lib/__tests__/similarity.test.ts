import { describe, expect, it } from "vitest";
import { kmeans } from "../cluster";
import { chunk } from "../classify";
import { readSSE } from "../sse-client";
import { dot, neighborConsensus, topK } from "../similarity";

describe("similarity", () => {
  it("dot and topK rank by cosine on unit vectors", () => {
    const pool = [
      { id: "x", embedding: [1, 0, 0] },
      { id: "y", embedding: [0, 1, 0] },
      { id: "near-x", embedding: [0.9578, 0.2873, 0] },
    ];
    expect(dot([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
    const neighbors = topK([1, 0, 0], pool, 2, "x");
    expect(neighbors.map((n) => n.id)).toEqual(["near-x", "y"]);
  });

  it("neighborConsensus measures disagreement against the majority", () => {
    const { majority, disagreement } = neighborConsensus(
      ["A", "A", "A", "B"],
      "B",
    );
    expect(majority).toBe("A");
    expect(disagreement).toBeCloseTo(0.75);
    expect(neighborConsensus([], "A")).toEqual({ majority: null, disagreement: 0 });
  });
});

describe("kmeans", () => {
  const clusterA = Array.from({ length: 10 }, (_, i) => ({
    id: `a${i}`,
    embedding: [1, 0.01 * i, 0].map((v, _, arr) => v / Math.hypot(...arr)),
  }));
  const clusterB = Array.from({ length: 10 }, (_, i) => ({
    id: `b${i}`,
    embedding: [0, 0.01 * i, 1].map((v, _, arr) => v / Math.hypot(...arr)),
  }));

  it("separates obvious clusters and partitions every item exactly once", () => {
    const clusters = kmeans([...clusterA, ...clusterB], 2);
    expect(clusters).toHaveLength(2);
    const memberSets = clusters.map((c) => new Set(c.memberIds.map((id) => id[0])));
    // Each cluster is homogeneous: all a's or all b's.
    for (const set of memberSets) expect(set.size).toBe(1);
    const all = clusters.flatMap((c) => c.memberIds).sort();
    expect(all).toHaveLength(20);
    expect(new Set(all).size).toBe(20);
  });

  it("is deterministic across runs (the demo depends on it)", () => {
    const items = [...clusterA, ...clusterB];
    const a = kmeans(items, 3);
    const b = kmeans(items, 3);
    expect(a.map((c) => c.memberIds)).toEqual(b.map((c) => c.memberIds));
  });
});

describe("chunk", () => {
  it("splits into batch-sized pieces without dropping items", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 15)).toEqual([]);
  });
});

describe("readSSE", () => {
  it("parses data frames across chunk boundaries", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        // A frame split mid-payload across two chunks, then a second frame.
        controller.enqueue(encoder.encode('data: {"type":"ba'));
        controller.enqueue(encoder.encode('tch","n":1}\n\ndata: {"type":"done"}\n\n'));
        controller.close();
      },
    });
    const events: { type: string }[] = [];
    for await (const e of readSSE<{ type: string }>(new Response(stream))) {
      events.push(e);
    }
    expect(events.map((e) => e.type)).toEqual(["batch", "done"]);
  });
});
