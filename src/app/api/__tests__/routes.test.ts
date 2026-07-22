import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, dbMock, updateChain, deleteReturning, selectQueue, acquireLockMock } =
  vi.hoisted(() => {
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
    };
  });

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/db", () => ({ db: dbMock }));
vi.mock("@/lib/classify-lock", () => ({
  acquireClassifyLock: acquireLockMock,
  releaseClassifyLock: vi.fn(),
}));
vi.mock("@/lib/corrections", () => ({ fetchCorrections: vi.fn(async () => []) }));

import { GET as threadsGet } from "../threads/route";
import { PATCH as threadPatch } from "../threads/[id]/route";
import { POST as classifyPost } from "../classify/route";
import { GET as bucketsGet, POST as bucketsPost } from "../buckets/route";
import { DELETE as bucketDelete, PATCH as bucketPatch } from "../buckets/[id]/route";
import { POST as suggestPost } from "../buckets/suggest/route";
import { POST as labelPost } from "../label/route";
import { DELETE as meDelete } from "../me/route";

const req = (path: string, init?: RequestInit) =>
  new NextRequest(`http://localhost:3000${path}`, init as ConstructorParameters<typeof NextRequest>[1]);
const params = { params: Promise.resolve({ id: "t1" }) };

beforeEach(() => {
  authMock.mockReset();
  acquireLockMock.mockReset();
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
      labelPost(req("/api/label", { method: "POST" })),
      meDelete(),
    ]);
    expect(responses.map((r) => r.status)).toEqual(Array(10).fill(401));
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
