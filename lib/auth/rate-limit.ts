/**
 * Best-effort per-instance rate limiting for money-adjacent routes.
 *
 * A fixed sliding window keyed by client IP and route. This is deliberately
 * dependency-free: on serverless it limits per instance rather than
 * globally, which blunts casual abuse and accidental loops. A shared
 * counter (Redis or Postgres) replaces this when abuse gets serious —
 * the call sites stay the same, only this module changes.
 */

const hits = new Map<string, number[]>();
const MAX_KEYS = 10_000;

export type RateLimit = { limited: boolean; retryAfterMs: number };

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): RateLimit {
  if (hits.size > MAX_KEYS) hits.clear();
  const cutoff = now - windowMs;
  const recent = (hits.get(key) ?? []).filter((t) => t > cutoff);
  if (recent.length >= limit) {
    const retryAfterMs = recent[0] + windowMs - now;
    hits.set(key, recent);
    return { limited: true, retryAfterMs: Math.max(retryAfterMs, 0) };
  }
  recent.push(now);
  hits.set(key, recent);
  return { limited: false, retryAfterMs: 0 };
}

/** Test hook: forgets all counters. */
export function resetRateLimits(): void {
  hits.clear();
}

export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || "unknown";
}
