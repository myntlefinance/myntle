import type { FetchLike, HttpFailure } from "../lib/http";

/**
 * The four upstreams the service talks to. `coingecko` is history-only, so a
 * live quote is always one of `LiveSourceName`; only a series may carry the
 * history fallback's label.
 */
export type SourceName = "binance" | "alchemy" | "oneclick" | "coingecko";

export type LiveSourceName = Exclude<SourceName, "coingecko">;

/**
 * Everything an adapter may need, passed in rather than read from `process.env`
 * or a binding. The Worker supplies the keys; the tests supply a fake clock and
 * a fake fetch. No adapter reaches for the environment on its own.
 */
export type SourceConfig = {
  alchemyKey?: string;
  binanceUsKey?: string;
  coingeckoKey?: string;
  /** Optional pro key; when set it wins over the demo key and the pro host. */
  coingeckoProKey?: string;
  /** The optional non-US accelerator, never a dependency. */
  binanceGlobal?: boolean;
  /** Total wall-clock budget for one Binance.US fetch across hosts. */
  binanceMaxMs?: number;
  /** How long the global host stays out after a 451/403. */
  binanceGlobalCooldownMs?: number;
  /** How long one 1Click catalogue fetch is reused. Defaults to its 60s TTL. */
  oneclickCacheMs?: number;
  fetchImpl?: FetchLike;
  now?: () => number;
};

/** One normalized live price. `assetId` is attached by the resolver. */
export type CurrentQuote = {
  assetId?: string;
  symbol: string;
  usd: number;
  asOf: number;
  source: LiveSourceName;
};

export type SeriesPoint = { time: number; value: number };

export type PriceSeries = {
  points: SeriesPoint[];
  source: SourceName;
  /** The newest observation's timestamp. */
  asOf: number;
  /** Percent move from the first point to the last; null without two points. */
  changePct: number | null;
  /**
   * True when a source honestly returned fewer than the 48-point contract.
   * The points are still real and are drawn as they arrived.
   */
  incomplete?: boolean;
};

export type SourceOk<T> = {
  ok: true;
  value: T;
  /**
   * True when a multi-chunk fetch produced some quotes but at least one chunk
   * failed with an outage. The value is usable; the source is not healthy,
   * and the breaker must see that.
   */
  partial?: boolean;
  /** How many chunks failed with an outage; present only with `partial`. */
  failedChunks?: number;
  /** The last failed chunk's Retry-After, when it sent one. */
  retryAfterMs?: number;
};

/** One source's part of an exhausted fallback walk, for /health and logs. */
export type SourceAttempt = {
  source: SourceName;
  error: string;
  status?: number;
  retryAfterMs?: number;
};

export type SourceFailure = {
  ok: false;
  error: string;
  status?: number;
  retryAfterMs?: number;
  /** Present when a resolver walked more than one candidate. */
  attempts?: SourceAttempt[];
};

export type SourceResult<T> = SourceOk<T> | SourceFailure;

/** A missing key is a configuration state, not a network failure. */
export const NOT_CONFIGURED = "not-configured";

export function fail(
  error: string,
  extra: { status?: number; retryAfterMs?: number } = {},
): SourceFailure {
  const result: SourceFailure = { ok: false, error };
  if (extra.status !== undefined) result.status = extra.status;
  if (extra.retryAfterMs !== undefined) result.retryAfterMs = extra.retryAfterMs;
  return result;
}

export function notConfigured(): SourceFailure {
  return fail(NOT_CONFIGURED);
}

/**
 * Translate the HTTP layer's failure into the adapter's result. The HTTP
 * status stays available for the DO's health record, but the error string is
 * the short code a caller branches on.
 */
export function fromHttp(result: HttpFailure): SourceFailure {
  if (result.status === null) {
    return fail(result.error === "timeout" ? "timeout" : "network");
  }

  if (result.error === "rate-limited") {
    return fail("rate-limited", {
      status: result.status,
      retryAfterMs: result.retryAfterMs,
    });
  }

  return fail(result.error, { status: result.status });
}

/**
 * A per-asset miss is not a source outage. A 404-like "unsupported" or an
 * empty history proves the host answered, so it closes a half-open breaker
 * rather than reopening it.
 */
const REACHABLE_ERRORS = new Set([
  "unsupported",
  "no-history",
  "invalid-symbol",
  "no-symbol",
  "not-configured",
]);

/**
 * True when the failure says the source itself is unreachable or refusing
 * work. A `Retry-After` (429/418) is always an outage signal, as is a 5xx, a
 * rejected credential, or a transport error. The adapters use this to decide
 * whether a failed chunk of a partly successful batch is an outage; the guard
 * uses it to decide whether the breaker counts the call.
 */
export function countsAsOutage(result: SourceFailure): boolean {
  if (result.retryAfterMs !== undefined) return true;
  if (result.status !== undefined) {
    return (
      result.status >= 500 ||
      result.status === 401 ||
      result.status === 403 ||
      result.status === 418 ||
      result.status === 429
    );
  }
  return !REACHABLE_ERRORS.has(result.error);
}
