/**
 * One HTTP policy for every price adapter: a hard deadline, at most one retry,
 * and error strings that are safe to log.
 *
 * A URL is never part of an error or a log line, because the Alchemy path
 * carries the API key. A response body is never part of one either: upstreams
 * answer with several hundred kilobytes and none of it explains the failure
 * better than the status does.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type HttpSuccess = {
  ok: true;
  status: number;
  /** Parsed JSON, or undefined when the body was not JSON. */
  body: unknown;
};

export type HttpFailure = {
  ok: false;
  error: string;
  status: number | null;
  /** Present only when the upstream sent a usable Retry-After. */
  retryAfterMs?: number;
};

export type HttpResult = HttpSuccess | HttpFailure;

export type HttpRequest = {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  now?: () => number;
  /**
   * Retry a 429 once, and only when the server allows an immediate retry.
   * Off by default: a Durable Object must never block for a Retry-After
   * window, so the caller decides when to come back. CoinGecko forbids the
   * retry outright on its free tier.
   */
  retryOn429?: boolean;
};

/** The hot-path budget from the plan. A probe may pass more. */
export const DEFAULT_TIMEOUT_MS = 4_000;

/** One original attempt plus at most one retry, never a loop. */
const MAX_ATTEMPTS = 2;

function parseBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Retry-After is either a number of seconds or an HTTP date. An invalid value
 * becomes undefined so the caller falls back to its own backoff instead of
 * trusting a number the upstream did not mean.
 */
export function parseRetryAfter(
  value: string | null,
  now: number,
): number | undefined {
  if (value === null) return undefined;

  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;

  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isFinite(seconds)
      ? Math.max(0, Math.round(seconds * 1000))
      : undefined;
  }

  // Only a real HTTP date contains letters (a month or a day name). Without
  // this, `Date.parse("-5")` would happily invent a year.
  if (!/[a-z]/i.test(trimmed)) return undefined;

  const date = Date.parse(trimmed);
  if (!Number.isFinite(date)) return undefined;
  return Math.max(0, date - now);
}

/**
 * Our own deadline, not the upstream's answer: retrying an abort would double
 * the budget for the same result. A rejected fetch without an abort name is a
 * network failure and is retried once.
 */
function isAbort(error: unknown): boolean {
  if (error instanceof DOMException) {
    return error.name === "TimeoutError" || error.name === "AbortError";
  }
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

/** Release an error body we will not read, so the connection is not held. */
async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // An already-closed body is the common case and is not a failure.
  }
}

function rateLimited(
  status: number,
  retryAfterMs: number | undefined,
): HttpFailure {
  const result: HttpFailure = { ok: false, error: "rate-limited", status };
  if (retryAfterMs !== undefined) result.retryAfterMs = retryAfterMs;
  return result;
}

function httpFailure(status: number): HttpFailure {
  return { ok: false, error: `http-${status}`, status };
}

/**
 * GET or POST a JSON endpoint under the shared policy.
 *
 * Retries: one for a 5xx or a network failure. A 429 is retried once only
 * when `retryOn429` is set and the server's Retry-After is zero or absent;
 * otherwise it is returned with `retryAfterMs` for the caller to schedule.
 * A 418 is Binance.US's IP-ban answer and is treated the same way. Every
 * other 4xx is final.
 */
export async function requestJson(request: HttpRequest): Promise<HttpResult> {
  const fetchImpl = request.fetchImpl ?? fetch;
  const now = request.now ?? Date.now;
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const headers: Record<string, string> = {
    accept: "application/json",
    "user-agent": "myntle-prices/1.0",
    ...request.headers,
  };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const init: RequestInit = {
      method: request.method ?? "GET",
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    };
    if (request.body !== undefined) init.body = request.body;

    let response: Response;
    try {
      response = await fetchImpl(request.url, init);
    } catch (error) {
      if (isAbort(error)) {
        return { ok: false, error: "timeout", status: null };
      }
      if (attempt === 1) continue;
      return { ok: false, error: "network", status: null };
    }

    if (response.ok) {
      let text: string;
      try {
        text = await response.text();
      } catch (error) {
        // A body can abort after the headers arrived. The request already has
        // an answer, so this is final rather than a retry candidate.
        return isAbort(error)
          ? { ok: false, error: "timeout", status: null }
          : { ok: false, error: "network", status: null };
      }

      return {
        ok: true,
        status: response.status,
        body: parseBody(text),
      };
    }

    if (response.status === 429 || response.status === 418) {
      const retryAfterMs = parseRetryAfter(
        response.headers.get("retry-after"),
        now(),
      );
      const immediate = retryAfterMs === undefined || retryAfterMs === 0;

      if (request.retryOn429 === true && attempt === 1 && immediate) {
        await discard(response);
        continue;
      }

      await discard(response);
      return rateLimited(response.status, retryAfterMs);
    }

    if (response.status >= 500 && attempt === 1) {
      await discard(response);
      continue;
    }

    await discard(response);
    return httpFailure(response.status);
  }

  // MAX_ATTEMPTS bounds the loop, so this is only reachable if that changes.
  return { ok: false, error: "network", status: null };
}
