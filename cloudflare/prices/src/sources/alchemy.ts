import { requestJson, type HttpFailure } from "../lib/http";
import { buildSeries } from "../series";
import {
  countsAsOutage,
  fail,
  fromHttp,
  notConfigured,
  type CurrentQuote,
  type PriceSeries,
  type SourceConfig,
  type SourceFailure,
  type SourceResult,
} from "./types";

/**
 * Alchemy Prices is the second live source and the second history source. It
 * aggregates CEX and DEX prices, allows at most 25 symbols per request, and
 * returns five-minute history over 24 hours (288 points) that we downsample.
 *
 * The key is part of the path, so it never reaches a log line, an error
 * string, or a thrown message from this module.
 */
const BASE_URL = "https://api.g.alchemy.com/prices/v1";
const CHUNK = 25;
const DAY_MS = 24 * 60 * 60 * 1000;

export type AlchemyAddress = {
  address: string;
  networks: string[];
};

export type AlchemySource = {
  readonly name: "alchemy";
  readonly configured: boolean;
  fetchCurrent(symbols: string[]): Promise<SourceResult<CurrentQuote[]>>;
  fetchCurrentByAddress(
    addresses: AlchemyAddress[],
  ): Promise<SourceResult<CurrentQuote[]>>;
  fetchSeries(symbol: string): Promise<SourceResult<PriceSeries>>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Alchemy sends ISO strings here; accept epoch seconds or milliseconds too. */
function toTimestamp(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return null;
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value !== "string") return null;

  const trimmed = value.trim();

  // A negative string is not an epoch and must not reach Date.parse, which
  // would read it as a year.
  if (trimmed.startsWith("-")) return null;

  // A numeric string is an epoch, not a date to hand to Date.parse, which
  // would read "1762000000" as a year rather than a Unix second.
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const epoch = Number(trimmed);
    if (!Number.isFinite(epoch) || epoch <= 0) return null;
    return epoch < 1e12 ? epoch * 1000 : epoch;
  }

  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function rowsOf(body: unknown): unknown[] | null {
  if (!isRecord(body) || !Array.isArray(body.data)) return null;
  return body.data;
}

/** The USD leg of a prices array, skipping an unsupported symbol's error row. */
function usdPrice(
  prices: unknown,
): { usd: number; asOf: number | null } | null {
  if (!Array.isArray(prices)) return null;

  for (const entry of prices) {
    if (!isRecord(entry)) continue;
    if (entry.currency !== "usd") continue;

    const usd = toNumber(entry.value);
    if (usd === null || usd < 0) return null;

    return { usd, asOf: toTimestamp(entry.lastUpdatedAt) };
  }

  return null;
}

/**
 * Rows without a symbol or a usable USD price are skipped rather than priced
 * at zero. An unsupported symbol comes back as a 200 row with an empty prices
 * array, which is exactly the case this drops.
 */
function parseCurrent(body: unknown, fetchedAt: number): CurrentQuote[] | null {
  const rows = rowsOf(body);
  if (rows === null) return null;

  const quotes: CurrentQuote[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;

    const symbol = toText(row.symbol);
    if (symbol === null) continue;

    const price = usdPrice(row.prices);
    if (price === null) continue;

    quotes.push({
      symbol,
      usd: price.usd,
      asOf: price.asOf ?? fetchedAt,
      source: "alchemy",
    });
  }
  return quotes;
}

function parseHistory(body: unknown): { time: number; value: number }[] | null {
  const rows = rowsOf(body);
  if (rows === null) return null;

  const points: { time: number; value: number }[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;

    const time = toTimestamp(row.timestamp);
    const value = toNumber(row.value);
    if (time === null || value === null || value < 0) continue;

    points.push({ time, value });
  }
  return points;
}

/** A 400 or 404 on this API means the symbol or coin is not covered. */
function alchemyFailure(result: HttpFailure): SourceFailure {
  if (result.status === 400 || result.status === 404) {
    return fail("unsupported", { status: result.status });
  }
  return fromHttp(result);
}

function uniqueSymbols(symbols: readonly string[]): string[] {
  return [...new Set(symbols.map((symbol) => symbol.trim()))].filter(
    (symbol) => symbol.length > 0,
  );
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

/**
 * A partly successful chunk walk still carries usable quotes, but a chunk
 * that failed with an outage is marked so the breaker is not told the source
 * is healthy when only part of the batch answered.
 */
function partialQuotes(
  quotes: CurrentQuote[],
  failedChunks: number,
  retryAfterMs: number | undefined,
): SourceResult<CurrentQuote[]> {
  if (failedChunks === 0) return { ok: true, value: quotes };
  return {
    ok: true,
    value: quotes,
    partial: true,
    failedChunks,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  };
}

export function createAlchemySource(
  config: SourceConfig = {},
): AlchemySource {
  const now = config.now ?? Date.now;
  const fetchImpl = config.fetchImpl ?? fetch;

  const rawKey = config.alchemyKey?.trim();
  const key = rawKey === undefined || rawKey.length === 0 ? null : rawKey;
  const base = key === null ? null : `${BASE_URL}/${key}`;

  return {
    name: "alchemy",
    configured: key !== null,

    /**
     * Chunks of 25. A partial answer is kept: the DO falls back per missing
     * asset, and losing eleven good prices because the twelfth chunk failed
     * would be worse than a mixed-source tick.
     */
    async fetchCurrent(symbols: string[]): Promise<SourceResult<CurrentQuote[]>> {
      if (base === null) return notConfigured();

      const wanted = uniqueSymbols(symbols);
      if (wanted.length === 0) return { ok: true, value: [] };

      const quotes: CurrentQuote[] = [];
      let last: SourceFailure | null = null;
      let failedChunks = 0;
      let retryAfterMs: number | undefined;

      for (const chunk of chunks(wanted, CHUNK)) {
        const params = encodeURIComponent(chunk.join(","));
        const result = await requestJson({
          url: `${base}/tokens/by-symbol?symbols=${params}`,
          fetchImpl,
          now,
        });

        if (!result.ok) {
          const failure = alchemyFailure(result);
          last = failure;
          if (countsAsOutage(failure)) {
            failedChunks += 1;
            if (failure.retryAfterMs !== undefined) {
              retryAfterMs = failure.retryAfterMs;
            }
          }
          continue;
        }

        const parsed = parseCurrent(result.body, now());
        if (parsed === null) {
          last = fail("malformed-response");
          failedChunks += 1;
          continue;
        }
        quotes.push(...parsed);
      }

      if (quotes.length > 0) {
        return partialQuotes(quotes, failedChunks, retryAfterMs);
      }
      return last ?? { ok: true, value: [] };
    },

    /**
     * The exact-address path, kept for the correctness upgrade. It is not
     * wired yet: v1 resolves symbols from the registry.
     */
    async fetchCurrentByAddress(
      addresses: AlchemyAddress[],
    ): Promise<SourceResult<CurrentQuote[]>> {
      if (base === null) return notConfigured();

      const wanted = addresses
        .map((entry) => ({
          address: entry.address.trim(),
          networks: entry.networks.filter(
            (network) => network.trim().length > 0,
          ),
        }))
        .filter((entry) => entry.address.length > 0 && entry.networks.length > 0);
      if (wanted.length === 0) return { ok: true, value: [] };

      const quotes: CurrentQuote[] = [];
      let last: SourceFailure | null = null;
      let failedChunks = 0;
      let retryAfterMs: number | undefined;

      for (const chunk of chunks(wanted, CHUNK)) {
        const result = await requestJson({
          url: `${base}/tokens/by-address`,
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ addresses: chunk }),
          fetchImpl,
          now,
        });

        if (!result.ok) {
          const failure = alchemyFailure(result);
          last = failure;
          if (countsAsOutage(failure)) {
            failedChunks += 1;
            if (failure.retryAfterMs !== undefined) {
              retryAfterMs = failure.retryAfterMs;
            }
          }
          continue;
        }

        const parsed = parseCurrent(result.body, now());
        if (parsed === null) {
          last = fail("malformed-response");
          failedChunks += 1;
          continue;
        }
        quotes.push(...parsed);
      }

      if (quotes.length > 0) {
        return partialQuotes(quotes, failedChunks, retryAfterMs);
      }
      return last ?? { ok: true, value: [] };
    },

    /**
     * 24 hours at five-minute spacing, downsampled to the chart's 48 points.
     * A short series is kept as it arrived; a 400/404 means the symbol has no
     * history on Alchemy and the caller moves on to CoinGecko.
     */
    async fetchSeries(symbol: string): Promise<SourceResult<PriceSeries>> {
      if (base === null) return notConfigured();

      const wanted = symbol.trim();
      if (wanted.length === 0) return fail("invalid-symbol");

      const end = now();
      const result = await requestJson({
        url: `${base}/tokens/historical`,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol: wanted,
          startTime: new Date(end - DAY_MS).toISOString(),
          endTime: new Date(end).toISOString(),
          interval: "5m",
        }),
        fetchImpl,
        now,
      });

      if (!result.ok) return alchemyFailure(result);

      const points = parseHistory(result.body);
      if (points === null) return fail("malformed-response");
      // An empty history is a miss, not a successful series: the resolver
      // must move on to CoinGecko rather than draw an empty line.
      if (points.length === 0) return fail("no-history");

      return { ok: true, value: buildSeries(points, "alchemy", end) };
    },
  };
}
