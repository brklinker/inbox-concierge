import { afterEach, describe, expect, it, vi } from "vitest";
import { getThreadMetadata, listThreadIds } from "../gmail";

function jsonResponse(body: object, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("listThreadIds", () => {
  it("paginates to the cap and stops", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          threads: Array.from({ length: 100 }, (_, i) => ({ id: `t${i}` })),
          nextPageToken: "page2",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          threads: Array.from({ length: 100 }, (_, i) => ({ id: `t${100 + i}` })),
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const ids = await listThreadIds("token", 200);
    expect(ids).toHaveLength(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain("pageToken=page2");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer token");
  });

  it("retries on 429 with backoff, then succeeds", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "rate" }, 429))
      .mockResolvedValueOnce(jsonResponse({ threads: [{ id: "t1" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const promise = listThreadIds("token", 1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await promise).toEqual(["t1"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up on non-retryable errors immediately", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "forbidden" }, 403));
    vi.stubGlobal("fetch", fetchMock);
    await expect(listThreadIds("token", 1)).rejects.toThrow("Gmail API 403");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("getThreadMetadata", () => {
  it("takes subject/sender from the first message, snippet/date from the last, decoded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          id: "t1",
          messages: [
            {
              internalDate: "1700000000000",
              snippet: "first",
              payload: {
                headers: [
                  { name: "Subject", value: "=?UTF-8?Q?Caf=C3=A9_time?=" },
                  { name: "From", value: "=?UTF-8?B?WsO2w6s=?= <Z@Example.com>" },
                ],
              },
            },
            {
              internalDate: "1700000100000",
              snippet: "last &amp; final‌‌",
              payload: { headers: [] },
            },
          ],
        }),
      ),
    );
    const meta = await getThreadMetadata("token", "t1");
    expect(meta).toEqual({
      id: "t1",
      subject: "Café time",
      sender: "Zöë <Z@Example.com>",
      senderDomain: "example.com",
      snippet: "last & final",
      internalDate: new Date(1700000100000),
    });
  });
});

