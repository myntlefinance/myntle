import {
  DEFAULT_TIMEOUT_MS,
  requestJson,
  type FetchLike,
  type HttpFailure,
} from "../lib/http";
import { KLINE_POINTS, parseKlines, parseTickerPrices } from "../probe";
import { buildSeries } from "../series";
import {
  countsAsOutage,
  fail,
  fromHttp,
  type CurrentQuote,
  type PriceSeries,
  type SourceConfig,
  type SourceFailure,
  type SourceResult,
} from "./types";

/**
 * Binance.US is the primary live source. The three US hostnames are documented
 * alternates and share an IP limit; a host that refuses the region (451 or
 * 403) or fails at the network layer rotates to the next one. `api.binance.com`
 * is an optional accelerator at the front, never a requirement.
 */
const US_HOSTS = [
  "https://api.binance.us",
  "https://api1.binance.us",
  "https://api2.binance.us",
] as const;
const GLOBAL_HOST = "https://api.binance.com";

/** `ticker/price?symbols=` accepts at most 100 symbols per call. */
const TICKER_CHUNK = 100;

/**
 * A whole fetch, across every host and every request-level retry, gets the
 * same four seconds as the rest of the hot path. Three hosts would otherwise
 * allow six calls and twenty-four seconds, which is longer than the Durable
 * Object's whole tick budget. Each host gets at most half of what remains.
 */
const DEFAULT_MAX_MS = 4_000;

/**
 * A global host that refuses the region is not retried on every tick. Ten
 * minutes is the same order as an IP ban window; the US hosts keep serving.
 */
const GLOBAL_COOLDOWN_MS = 10 * 60_000;

export type BinanceSource = {
  readonly name: "binance";
  readonly configured: true;
  fetchCurrent(pairs: string[]): Promise<SourceResult<CurrentQuote[]>>;
  fetchSeries(pair: string): Promise<SourceResult<PriceSeries>>;
};

type RotationOptions = {
  hosts: readonly string[];
  path: string;
  headers?: Record<string, string>;
  /** Epoch milliseconds after which no new host attempt starts. */
  deadline: number;
  onRefused?: (host: string, result: HttpFailure) => void;
  fetchImpl: FetchLike;
  now: () => number;
};

/**
 * Retry on the next host for a network failure, a 5xx, or a regional refusal.
 * A 429 or 418 is a rate decision, not a bad host: rotating would spend the
 * same shared limit on another name and hide the Retry-After the caller needs.
 */
function shouldRotate(result: HttpFailure): boolean {
  if (result.status === null) return true;
  if (result.status === 403 || result.status === 451) return true;
  return result.status >= 500;
}

/**
 * Try hosts in order under one deadline. `parse` returning null means the host
 * answered 200 with something unusable, which is also worth a rotation. The
 * last failure is returned when no host produces a value, so the caller sees
 * the real reason (a 451 is more useful in /health than a generic network
 * error).
 */
async function withRotation<T>(
  options: RotationOptions,
  parse: (body: unknown) => T | null,
): Promise<SourceResult<T>> {
  let last: SourceFailure | null = null;

  for (const host of options.hosts) {
    const remaining = options.deadline - options.now();
    if (remaining <= 0) break;

    const result = await requestJson({
      url: `${host}${options.path}`,
      headers: options.headers,
      // Half the remaining budget, so the request's own retry still fits
      // inside the deadline rather than doubling it. AbortSignal.timeout
      // requires an integer number of milliseconds.
      timeoutMs: Math.max(
        1,
        Math.ceil(Math.min(DEFAULT_TIMEOUT_MS, remaining / 2)),
      ),
      fetchImpl: options.fetchImpl,
      now: options.now,
    });

    if (result.ok) {
      const parsed = parse(result.body);
      if (parsed !== null) return { ok: true, value: parsed };
      last = fail("malformed-response");
      continue;
    }

    last = fromHttp(result);
    if (result.status === 451 || result.status === 403) {
      options.onRefused?.(host, result);
    }
    if (!shouldRotate(result)) return last;
  }

  // No host was tried because the budget was already spent.
  return last ?? fail("timeout");
}

function uniquePairs(pairs: readonly string[]): string[] {
  return [...new Set(pairs.map((pair) => pair.trim().toUpperCase()))].filter(
    (pair) => pair.length > 0,
  );
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

function tickerPath(pairs: readonly string[]): string {
  // The endpoint expects a JSON array, percent-encoded exactly as the live
  // probe sends it.
  return `/api/v3/ticker/price?symbols=${encodeURIComponent(
    JSON.stringify(pairs),
  )}`;
}

function klinesPath(pair: string): string {
  return `/api/v3/klines?symbol=${encodeURIComponent(
    pair,
  )}&interval=30m&limit=${KLINE_POINTS}`;
}

export function createBinanceSource(
  config: SourceConfig = {},
): BinanceSource {
  const now = config.now ?? Date.now;
  const fetchImpl = config.fetchImpl ?? fetch;
  const maxTotalMs = Math.max(1, config.binanceMaxMs ?? DEFAULT_MAX_MS);
  const globalCooldownMs = Math.max(
    0,
    config.binanceGlobalCooldownMs ?? GLOBAL_COOLDOWN_MS,
  );

  // Public data needs no key today. The header is supported because the policy
  // could tighten, and an empty value must not be sent as a key.
  const key = config.binanceUsKey?.trim();
  const headers =
    key === undefined || key.length === 0 ? undefined : { "x-mbx-apikey": key };

  // Remembered across calls so a regional refusal does not cost one failed
  // request per tick for the whole ban window.
  let globalDisabledUntil = 0;

  function hostsForCall(): readonly string[] {
    if (config.binanceGlobal !== true) return US_HOSTS;
    return now() < globalDisabledUntil ? US_HOSTS : [GLOBAL_HOST, ...US_HOSTS];
  }

  function onRefused(host: string, result: HttpFailure): void {
    if (
      host === GLOBAL_HOST &&
      (result.status === 451 || result.status === 403)
    ) {
      globalDisabledUntil = now() + globalCooldownMs;
    }
  }

  return {
    name: "binance",
    configured: true,

    /**
     * One request per 100 pairs. A failed chunk does not discard the others:
     * the caller sees the quotes that arrived and falls back per asset for
     * the rest. A chunk that failed with an outage is marked on the ok
     * result, so the breaker is not told the source is healthy when only
     * part of the batch answered. The endpoint carries no per-symbol
     * timestamp, so `asOf` is the moment of the call.
     */
    async fetchCurrent(pairs: string[]): Promise<SourceResult<CurrentQuote[]>> {
      const wanted = uniquePairs(pairs);
      if (wanted.length === 0) return { ok: true, value: [] };

      const deadline = now() + maxTotalMs;
      const quotes: CurrentQuote[] = [];
      let last: SourceFailure | null = null;
      let failedChunks = 0;
      let retryAfterMs: number | undefined;

      for (const chunk of chunks(wanted, TICKER_CHUNK)) {
        const at = now();
        const wantedSet = new Set(chunk);
        const result = await withRotation(
          {
            hosts: hostsForCall(),
            path: tickerPath(chunk),
            headers,
            deadline,
            onRefused,
            fetchImpl,
            now,
          },
          (body) => {
            const prices = parseTickerPrices(body).filter((price) =>
              wantedSet.has(price.symbol),
            );
            if (prices.length === 0) return null;
            return prices.map(
              (price): CurrentQuote => ({
                symbol: price.symbol,
                usd: price.price,
                asOf: at,
                source: "binance",
              }),
            );
          },
        );

        if (result.ok) {
          quotes.push(...result.value);
        } else {
          last = result;
          if (countsAsOutage(result)) {
            failedChunks += 1;
            if (result.retryAfterMs !== undefined) {
              retryAfterMs = result.retryAfterMs;
            }
          }
        }
      }

      if (quotes.length > 0) {
        if (failedChunks > 0) {
          return {
            ok: true,
            value: quotes,
            partial: true,
            failedChunks,
            ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
          };
        }
        return { ok: true, value: quotes };
      }
      return last ?? fail("malformed-response");
    },

    /**
     * Half-hour candles. A short answer is returned with `incomplete: true`
     * rather than padded or thrown away: the plan keeps the points the source
     * honestly reported. The last candle is still open; its close is the
     * current price at fetch time.
     */
    async fetchSeries(pair: string): Promise<SourceResult<PriceSeries>> {
      const symbol = pair.trim().toUpperCase();
      if (symbol.length === 0) return fail("invalid-symbol");

      const at = now();
      const result = await withRotation(
        {
          hosts: hostsForCall(),
          path: klinesPath(symbol),
          headers,
          deadline: at + maxTotalMs,
          onRefused,
          fetchImpl,
          now,
        },
        (body) => {
          const points = parseKlines(body);
          if (points.length === 0) return null;
          return buildSeries(points, "binance", at);
        },
      );

      if (!result.ok) return result;
      if (result.value.points.length < KLINE_POINTS) {
        return { ok: true, value: { ...result.value, incomplete: true } };
      }
      return result;
    },
  };
}
