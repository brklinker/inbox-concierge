import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  authMock,
  dbMock,
  updateChain,
  deleteReturning,
  selectQueue,
  acquireLockMock,
  evaluateFitMock,
  classifyBatchMock,
  answerQueryMock,
} = vi.hoisted(() => {
    const updateChain = {
      set: vi.fn(),
      where: vi.fn(),
      returning: vi.fn(),
    };
    updateChain.set.mockReturnValue(updateChain);
    updateChain.where.mockReturnValue(updateChain);
    const deleteReturning = vi.fn();
    // Each db.select() resolves to the next queued row set (empty if the
    // queue runs dry), regardless of chained from/where/orderBy calls.
    const selectQueue: unknown[] = [];
    interface SelectChain {
      from: () => SelectChain;
      where: () => SelectChain;
      orderBy: () => SelectChain;
      then: (resolve: (value: unknown) => void) => void;
    }
    const selectChain: SelectChain = {
      from: () => selectChain,
      where: () => selectChain,
      orderBy: () => selectChain,
      then: (resolve) => resolve(selectQueue.shift() ?? []),
    };
    const dbMock = {
      update: vi.fn(() => updateChain),
      delete: vi.fn(() => ({
        where: vi.fn(() => ({ returning: deleteReturning })),
      })),
      select: vi.fn(() => selectChain),
    };
    return {
      authMock: vi.fn(),
      dbMock,
      updateChain,
      deleteReturning,
      selectQueue,
      acquireLockMock: vi.fn(),
      evaluateFitMock: vi.fn(),
      classifyBatchMock: vi.fn(),
      answerQueryMock: vi.fn(),
    };
  });

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/db", () => ({ db: dbMock }));
vi.mock("@/lib/classify-lock", () => ({
  acquireClassifyLock: acquireLockMock,
  releaseClassifyLock: vi.fn(),
}));
vi.mock("@/lib/corrections", () => ({ fetchCorrections: vi.fn(async () => []) }));
vi.mock("@/lib/openai", () => ({
  embedTexts: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2])),
  embeddingInput: vi.fn((t: { subject?: string | null }) => t.subject ?? ""),
}));
vi.mock("@/lib/classify", () => ({
  CLASSIFY_BATCH_SIZE: 15,
  CLASSIFY_CONCURRENCY: 5,
  chunk: <T,>(items: T[], size: number) => {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
  },
  classifyBatch: classifyBatchMock,
  evaluateBucketFit: evaluateFitMock,
  suggestBuckets: vi.fn(async () => []),
  answerInboxQuery: answerQueryMock,
}));

import { GET as threadsGet } from "../threads/route";
import { PATCH as threadPatch } from "../threads/[id]/route";
import { POST as classifyPost } from "../classify/route";
import { GET as bucketsGet, POST as bucketsPost } from "../buckets/route";
import { DELETE as bucketDelete, PATCH as bucketPatch } from "../buckets/[id]/route";
import { POST as suggestPost } from "../buckets/suggest/route";
import { POST as searchPost } from "../search/route";
import { POST as labelPost } from "../label/route";
import { DELETE as meDelete } from "../me/route";

const req = (path: string, init?: RequestInit) =>
  new NextRequest(`http://localhost:3000${path}`, init as ConstructorParameters<typeof NextRequest>[1]);
const params = { params: Promise.resolve({ id: "t1" }) };

beforeEach(() => {
  authMock.mockReset();
  acquireLockMock.mockReset();
  evaluateFitMock.mockReset();
  classifyBatchMock.mockReset();
  answerQueryMock.mockReset();
  selectQueue.length = 0;
});

describe("every route rejects unauthenticated requests", () => {
  it("returns 401 across the API surface when there is no session", async () => {
    authMock.mockResolvedValue(null);
    const responses = await Promise.all([
      threadsGet(req("/api/threads")),
      threadPatch(req("/api/threads/t1", { method: "PATCH" }), params),
      classifyPost(req("/api/classify", { method: "POST" })),
      bucketsGet(),
      bucketsPost(req("/api/buckets", { method: "POST" })),
      bucketPatch(req("/api/buckets/t1", { method: "PATCH" }), params),
      bucketDelete(req("/api/buckets/t1", { method: "DELETE" }), params),
      suggestPost(),
      searchPost(req("/api/search", { method: "POST" })),
      labelPost(req("/api/label", { method: "POST" })),
      meDelete(),
    ]);
    expect(responses.map((r) => r.status)).toEqual(Array(11).fill(401));
  });

  it("treats a failed token refresh as unauthenticated", async () => {
    authMock.mockResolvedValue({
      user: { email: "u@x.com" },
      accessToken: "tok",
      error: "RefreshTokenError",
    });
    const res = await threadsGet(req("/api/threads"));
    expect(res.status).toBe(401);
  });
});

describe("POST /api/classify — cost guards", () => {
  it("returns 409 when another run holds the per-user lease", async () => {
    authMock.mockResolvedValue({ user: { email: "lease@x.com" } });
    acquireLockMock.mockResolvedValue(false);
    selectQueue.push(
      [{ id: "b1", name: "Important", description: null, position: 0 }],
      [],
    );
    const res = await classifyPost(
      req("/api/classify", { method: "POST", body: "{}" }),
    );
    expect(res.status).toBe(409);
  });

  it("rate limits after 10 runs inside the window", async () => {
    authMock.mockResolvedValue({ user: { email: "burst@x.com" } });
    acquireLockMock.mockResolvedValue(false);
    let last: Response | null = null;
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      last = await classifyPost(
        req("/api/classify", { method: "POST", body: "{}" }),
      );
      statuses.push(last.status);
    }
    expect(statuses[0]).not.toBe(429);
    expect(statuses[10]).toBe(429);
    expect(Number(last!.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
  });
});

describe("PATCH /api/buckets/[id] — edit re-sorts", () => {
  const bucket = {
    id: "t1",
    userEmail: "edit@x.com",
    name: "Notifications",
    description: "old criteria",
    isDefault: true,
    position: 2,
  };

  it("skips the re-sort when criteria are unchanged", async () => {
    authMock.mockResolvedValue({ user: { email: "edit1@x.com" } });
    selectQueue.push([bucket]);
    updateChain.returning.mockResolvedValue([bucket]);
    const res = await bucketPatch(
      req("/api/buckets/t1", {
        method: "PATCH",
        body: JSON.stringify({ name: bucket.name, description: bucket.description }),
      }),
      params,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).scanned).toBeUndefined();
    expect(evaluateFitMock).not.toHaveBeenCalled();
    expect(classifyBatchMock).not.toHaveBeenCalled();
  });

  it("re-files in both directions on a criteria change, skipping corrected threads", async () => {
    authMock.mockResolvedValue({ user: { email: "edit2@x.com" } });
    const updated = { ...bucket, description: "new criteria" };
    const other = { ...bucket, id: "b2", name: "Auto-Archive" };
    const thread = (over: object) => ({
      id: "x",
      userEmail: "edit2@x.com",
      sender: "s",
      subject: "subj",
      snippet: "snip",
      internalDate: null,
      embedding: [1, 1],
      bucketId: null,
      confidence: 0.9,
      correctedAt: null,
      ...over,
    });
    selectQueue.push(
      [bucket], // ownedBucket
      [updated, other], // all buckets
      [
        thread({ id: "m1", bucketId: "t1" }), // member — re-check out
        thread({ id: "m2", bucketId: "t1", correctedAt: new Date() }), // corrected — untouchable
        thread({ id: "o1", bucketId: "b2", confidence: 0.4 }), // candidate — check in
      ],
    );
    updateChain.returning.mockResolvedValue([updated]);
    evaluateFitMock.mockResolvedValue([
      { id: "o1", move: true, confidence: 0.9, reason: "fits" },
    ]);
    classifyBatchMock.mockResolvedValue([
      { id: "m1", bucket: "Auto-Archive", confidence: 0.8, reason: "noise" },
    ]);

    const res = await bucketPatch(
      req("/api/buckets/t1", {
        method: "PATCH",
        body: JSON.stringify({ description: "new criteria" }),
      }),
      params,
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.scanned).toBe(3);
    expect(data.evaluated).toBe(2);
    const movedById = new Map(
      (data.moved as { id: string; bucketId: string }[]).map((m) => [m.id, m.bucketId]),
    );
    expect(movedById.get("o1")).toBe("t1");
    expect(movedById.get("m1")).toBe("b2");
    // The corrected member was never sent to the LLM.
    const memberIds = classifyBatchMock.mock.calls[0][0].map((t: { id: string }) => t.id);
    expect(memberIds).toEqual(["m1"]);
  });
});

describe("POST /api/label", () => {
  it("writes the gold label scoped to the signed-in user", async () => {
    authMock.mockResolvedValue({ user: { email: "u@x.com" } });
    updateChain.returning.mockResolvedValue([{ id: "t1", goldLabel: "Important" }]);
    const res = await labelPost(
      req("/api/label", {
        method: "POST",
        body: JSON.stringify({ threadId: "t1", goldLabel: "Important" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "t1", goldLabel: "Important" });
    expect(updateChain.set).toHaveBeenCalledWith({ goldLabel: "Important" });
  });

  it("rejects a missing threadId", async () => {
    authMock.mockResolvedValue({ user: { email: "u@x.com" } });
    const res = await labelPost(
      req("/api/label", { method: "POST", body: JSON.stringify({}) }),
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/search — ask your inbox", () => {
  const searchReq = (query: unknown) =>
    req("/api/search", { method: "POST", body: JSON.stringify({ query }) });

  it("rejects an empty query before touching the DB or LLM", async () => {
    authMock.mockResolvedValue({ user: { email: "s1@x.com" } });
    const res = await searchPost(searchReq("   "));
    expect(res.status).toBe(400);
    expect(answerQueryMock).not.toHaveBeenCalled();
  });

  it("returns relevant matches with retrieval counts", async () => {
    authMock.mockResolvedValue({ user: { email: "s2@x.com" } });
    selectQueue.push(
      // pool: one thread whose embedding clears the similarity floor
      [
        {
          id: "t1",
          sender: "Recruiter <r@x.com>",
          subject: "Backend role",
          snippet: "hi",
          internalDate: null,
          bucketId: "b1",
          embedding: [1, 1],
        },
      ],
      [{ id: "b1", name: "Recruiters" }], // buckets
    );
    answerQueryMock.mockResolvedValue({
      answer: "One recruiter thread about a backend role.",
      matches: [{ id: "t1", reason: "backend recruiter outreach" }],
    });
    const res = await searchPost(searchReq("backend recruiter threads"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({
      answer: "One recruiter thread about a backend role.",
      results: [{ id: "t1", reason: "backend recruiter outreach" }],
      scanned: 1,
      evaluated: 1,
      matched: 1,
    });
  });

  it("skips the LLM when nothing clears the similarity floor", async () => {
    authMock.mockResolvedValue({ user: { email: "s3@x.com" } });
    selectQueue.push(
      // embedding barely overlaps the mocked query vector [0.1, 0.2]
      [{ id: "t1", sender: "s", subject: "x", snippet: null, internalDate: null, bucketId: null, embedding: [0.1, 0.1] }],
      [],
    );
    const res = await searchPost(searchReq("something unrelated"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.matched).toBe(0);
    expect(data.evaluated).toBe(0);
    expect(answerQueryMock).not.toHaveBeenCalled();
  });

  it("returns an empty result when the mailbox has no embedded threads", async () => {
    authMock.mockResolvedValue({ user: { email: "s4@x.com" } });
    selectQueue.push([]); // empty pool
    const res = await searchPost(searchReq("anything"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.scanned).toBe(0);
    expect(answerQueryMock).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/me", () => {
  it("deletes threads and buckets and reports counts", async () => {
    authMock.mockResolvedValue({ user: { email: "u@x.com" } });
    deleteReturning
      .mockResolvedValueOnce([{ id: "t1" }, { id: "t2" }])
      .mockResolvedValueOnce([{ id: "b1" }]);
    const res = await meDelete();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ threads: 2, buckets: 1 });
  });
});
