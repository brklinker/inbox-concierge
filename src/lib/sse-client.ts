/**
 * Read an SSE response body (from fetch, so POST works — EventSource can't)
 * and yield each `data:` payload parsed as JSON.
 */
export async function* readSSE<T>(res: Response): AsyncGenerator<T> {
  if (!res.body) throw new Error("Response has no body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      for (const line of frame.split("\n")) {
        if (line.startsWith("data: ")) {
          yield JSON.parse(line.slice(6)) as T;
        }
      }
    }
  }
}
