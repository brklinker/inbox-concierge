import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../openai", () => ({
  CLASSIFY_MODEL: "test-model",
  openai: { chat: { completions: { parse: vi.fn() } } },
}));

import {
  classifyBatch,
  evaluateBucketFit,
  suggestBuckets,
  type ClassifiableThread,
} from "../classify";
import { openai } from "../openai";

const parse = openai.chat.completions.parse as ReturnType<typeof vi.fn>;

const BUCKETS = [
  { name: "Important", description: "urgent" },
  { name: "Auto-Archive", description: "noise" },
];

function thread(id: string): ClassifiableThread {
  return { id, sender: `s-${id}`, subject: `subj-${id}`, snippet: null, date: null };
}

function completion(results: object[]) {
  return { choices: [{ message: { parsed: { results } } }] };
}

beforeEach(() => parse.mockReset());

describe("classifyBatch", () => {
  it("returns matched results and clamps confidence to [0, 1]", async () => {
    parse.mockResolvedValueOnce(
      completion([
        { id: "a", bucket: "Important", confidence: 1.7, reason: "r" },
        { id: "b", bucket: "Auto-Archive", confidence: -0.2, reason: "r" },
      ]),
    );
    const out = await classifyBatch([thread("a"), thread("b")], BUCKETS);
    expect(out.map((r) => [r.id, r.confidence])).toEqual([
      ["a", 1],
      ["b", 0],
    ]);
  });

  it("drops hallucinated ids and retries the threads they displaced", async () => {
    parse
      .mockResolvedValueOnce(
        completion([
          { id: "a", bucket: "Important", confidence: 0.9, reason: "r" },
          { id: "ghost", bucket: "Auto-Archive", confidence: 0.9, reason: "r" },
        ]),
      )
      .mockResolvedValueOnce(
        completion([{ id: "b", bucket: "Important", confidence: 0.8, reason: "r" }]),
      );
    const out = await classifyBatch([thread("a"), thread("b")], BUCKETS);
    expect(out.map((r) => r.id).sort()).toEqual(["a", "b"]);
    // The retry batch contains only the missing thread.
    const retryInput = JSON.parse(parse.mock.calls[1][0].messages[1].content);
    expect(retryInput.map((t: { id: string }) => t.id)).toEqual(["b"]);
  });

  it("treats duplicated ids as poisoned: the id-echo swap fingerprint", async () => {
    // Observed live: the model stamped a Steam promo's verdict with a Sequoia
    // thread's id. Both occurrences must die and both threads get resent.
    parse
      .mockResolvedValueOnce(
        completion([
          { id: "a", bucket: "Important", confidence: 0.9, reason: "real" },
          { id: "a", bucket: "Auto-Archive", confidence: 0.8, reason: "stolen" },
        ]),
      )
      .mockResolvedValueOnce(
        completion([
          { id: "a", bucket: "Important", confidence: 0.9, reason: "r" },
          { id: "b", bucket: "Auto-Archive", confidence: 0.9, reason: "r" },
        ]),
      );
    const out = await classifyBatch([thread("a"), thread("b")], BUCKETS);
    expect(out).toHaveLength(2);
    const retryInput = JSON.parse(parse.mock.calls[1][0].messages[1].content);
    expect(retryInput.map((t: { id: string }) => t.id).sort()).toEqual(["a", "b"]);
  });

  it("retries at most once — no infinite loops on a stubborn model", async () => {
    parse.mockResolvedValue(completion([]));
    const out = await classifyBatch([thread("a")], BUCKETS);
    expect(out).toEqual([]);
    expect(parse).toHaveBeenCalledTimes(2);
  });

  const oneResult = completion([
    { id: "a", bucket: "Important", confidence: 0.9, reason: "r" },
  ]);

  it("injects user corrections into the system prompt as examples", async () => {
    parse.mockResolvedValueOnce(oneResult);
    await classifyBatch([thread("a")], BUCKETS, [
      { sender: "Recruiter <r@x.com>", subject: "Role", snippet: "hi", bucket: "Recruiters" },
    ]);
    const system = parse.mock.calls[0][0].messages[0].content as string;
    expect(system).toContain("manually re-filed");
    expect(system).toContain("Recruiter <r@x.com>");
    expect(system).toContain("→ Recruiters");
  });

  it("omits the corrections section when there are none", async () => {
    parse.mockResolvedValueOnce(oneResult);
    await classifyBatch([thread("a")], BUCKETS);
    const system = parse.mock.calls[0][0].messages[0].content as string;
    expect(system).not.toContain("manually re-filed");
  });
});

describe("evaluateBucketFit", () => {
  const NEW_BUCKET = { name: "Recruiters", description: "recruiter mail" };

  it("applies the same duplicate-id guard and retry", async () => {
    parse
      .mockResolvedValueOnce(
        completion([
          { id: "a", move: true, confidence: 0.9, reason: "r" },
          { id: "a", move: false, confidence: 0.9, reason: "r" },
        ]),
      )
      .mockResolvedValueOnce(
        completion([
          { id: "a", move: true, confidence: 0.9, reason: "r" },
          { id: "b", move: false, confidence: 0.9, reason: "r" },
        ]),
      );
    const out = await evaluateBucketFit(
      [
        { ...thread("a"), currentBucket: "Important" },
        { ...thread("b"), currentBucket: "Important" },
      ],
      NEW_BUCKET,
      [...BUCKETS, NEW_BUCKET],
    );
    expect(out.map((r) => [r.id, r.move]).sort()).toEqual([
      ["a", true],
      ["b", false],
    ]);
  });
});

describe("suggestBuckets", () => {
  it("keeps proposals, drops declines and names colliding with existing buckets", async () => {
    parse.mockResolvedValueOnce(
      completion([
        { clusterIndex: 0, propose: true, name: " Job Search ", description: "d1" },
        { clusterIndex: 1, propose: false, name: "Covered", description: "d2" },
        { clusterIndex: 2, propose: true, name: "important", description: "d3" },
        { clusterIndex: 3, propose: true, name: "Job Search", description: "dupe" },
      ]),
    );
    const out = await suggestBuckets(
      [0, 1, 2, 3].map((clusterIndex) => ({ clusterIndex, size: 10, examples: [] })),
      BUCKETS,
    );
    expect(out).toEqual([
      { clusterIndex: 0, name: "Job Search", description: "d1" },
    ]);
  });
});
