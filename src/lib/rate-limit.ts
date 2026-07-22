// Sliding-window rate limiter for the LLM-spending routes. In-memory, so
// per serverless instance: a cost brake, not a security boundary. The
// durable gates are auth (only OAuth test users can hold a session) and
// the DB classify lease.
const hits = new Map<string, number[]>();

export function rateLimit(
  key: string,
  max: number,
  windowMs: number,
  now = Date.now(),
): { ok: true } | { ok: false; retryAfterSeconds: number } {
  const cutoff = now - windowMs;
  const kept = (hits.get(key) ?? []).filter((t) => t > cutoff);
  if (kept.length >= max) {
    hits.set(key, kept);
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil((kept[0] + windowMs - now) / 1000)),
    };
  }
  kept.push(now);
  hits.set(key, kept);
  return { ok: true };
}

export function rateLimitResponse(retryAfterSeconds: number) {
  return Response.json(
    { error: `Too many requests — try again in ${retryAfterSeconds}s.` },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}
