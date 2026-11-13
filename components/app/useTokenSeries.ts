"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { LivelinePoint } from "liveline";
import { usePrice } from "./usePrice";
import {
  pickSymbolAssetForHistory,
  resolveSymbolRows,
} from "./useAssetPrice";
import type { LiveQuote, PriceSource } from "./priceStore";
import { isPricesLive } from "@/lib/prices/flags";

/* ─────────────────────────────────────────────────────────
 * TOKEN SERIES
 * The 24-hour line in the token card. The Worker owns the history:
 * this hook fetches it once when the card opens, caches it for half
 * an hour, and joins the live store quote to the right edge only
 * when both numbers came from the same source. The chart and the
 * percent always read the same points, so the number can never
 * describe a line that is not on screen.
 * ───────────────────────────────────────────────────────── */

export const TOKEN_SERIES_RANGE = "24h" as const;
export type TokenSeriesRange = typeof TOKEN_SERIES_RANGE;

/** History may come from CoinGecko, which never prices a live quote. */
export type TokenSeriesSource = PriceSource | "coingecko";

/** A `/history` point. `time` is epoch milliseconds, as the Worker sends it. */
export type HistoryPoint = { time: number; value: number };

/**
 * A history read that failed at the HTTP boundary. The status is kept so the
 * query's retry predicate can tell a refusal (4xx, including 429) from an
 * outage (5xx or no response at all).
 */
export class TokenSeriesError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "TokenSeriesError";
    this.status = status;
  }
}

/**
 * Retry policy for the history query. A 4xx is the service saying no: a bad
 * asset id or a rate limit is not repaired by asking again. A 5xx or a
 * transport failure gets one retry, which is enough to ride out a blip
 * without turning a card into a retry loop.
 */
export function shouldRetryTokenSeries(
  failureCount: number,
  error: unknown,
): boolean {
  if (error instanceof Error) {
    // A closed card aborts its read; asking again would only abort again.
    if (error.name === "AbortError" || error.name === "CancelledError") {
      return false;
    }
  }
  if (
    error instanceof TokenSeriesError &&
    error.status !== undefined &&
    error.status >= 400 &&
    error.status < 500
  ) {
    return false;
  }
  return failureCount < 1;
}

const DEFAULT_HISTORY_URL = "https://myntle-prices.myntle.workers.dev";
const SERIES_SOURCES = new Set<string>([
  "binance",
  "alchemy",
  "oneclick",
  "coingecko",
]);
const EMPTY_HISTORY_POINTS: HistoryPoint[] = [];

/** A viewport warm-up is fresh for the same half hour the query is. */
const PREFETCH_TTL_MS = 30 * 60_000;
/** A warm-up gives up rather than holding a chip's request open. */
const PREFETCH_TIMEOUT_MS = 8_000;

type PrefetchedSeries = { data: TokenSeriesData; at: number };

/** Series written before their card mounts, keyed by the asset the key uses. */
const prefetchedSeries = new Map<string, PrefetchedSeries>();
/** One history request per asset while a warm-up is in flight. */
const prefetchInflight = new Map<string, Promise<void>>();
/** The request itself, shared by the warm-up and the popup's query. */
const seriesInflight = new Map<string, Promise<TokenSeriesData>>();

function freshPrefetchedSeries(assetId: string): PrefetchedSeries | null {
  const cached = prefetchedSeries.get(assetId);
  if (!cached) return null;
  if (Date.now() - cached.at >= PREFETCH_TTL_MS) {
    prefetchedSeries.delete(assetId);
    return null;
  }
  return cached;
}

/** The cache key, in one place so a prefetch and the card agree. */
export function tokenSeriesQueryKey(
  assetId: string | null | undefined,
  range: TokenSeriesRange = TOKEN_SERIES_RANGE,
) {
  return ["price-series", assetId ?? null, range] as const;
}

/**
 * Whether this card should ask the Worker for a line at all. The rollout flag
 * turns the whole history path off, and a missing id keeps the query waiting
 * for the catalogue rather than fetching a chart for nothing.
 */
export function tokenSeriesEnabled(
  assetId: string | null | undefined,
  enabled = true,
): boolean {
  const id = assetId?.trim() ?? "";
  return enabled && id.length > 0 && isPricesLive();
}

/** The public history route. The base is configuration, not a secret. */
export function tokenHistoryUrl(
  assetId: string,
  range: TokenSeriesRange = TOKEN_SERIES_RANGE,
): string {
  const base = (
    process.env.NEXT_PUBLIC_PRICES_HTTP_URL || DEFAULT_HISTORY_URL
  ).replace(/\/+$/, "");
  return `${base}/history?asset=${encodeURIComponent(assetId)}&range=${range}`;
}

/** The move from the first close to the last, in percent. */
export function seriesChangePct(
  points: readonly HistoryPoint[],
): number | null {
  if (points.length < 2) return null;
  const first = points[0]?.value;
  const last = points.at(-1)?.value;
  if (
    first === undefined ||
    last === undefined ||
    !Number.isFinite(first) ||
    !Number.isFinite(last) ||
    first <= 0
  ) {
    return null;
  }
  return ((last - first) / first) * 100;
}

/**
 * Join the live quote to the series' right edge.
 *
 * The append is deliberately narrow: the quote must carry the same source
 * as the series, and it must be strictly newer than the last close. A
 * mismatch keeps the series' own last point rather than inventing a join
 * between two feeds, and an empty series stays empty so the chart's
 * “No data to display” state is the honest answer.
 *
 * Points are in milliseconds here, the unit `/history` uses; the chart
 * conversion happens once, after this merge.
 */
export function appendLivePoint(
  points: readonly HistoryPoint[],
  live: Pick<LiveQuote, "usd" | "asOf" | "source"> | null | undefined,
  source: TokenSeriesSource | null | undefined,
): { points: readonly HistoryPoint[]; changePct: number | null } {
  const changePct = seriesChangePct(points);
  if (!live || !source || live.source !== source) {
    return { points, changePct };
  }

  const last = points.at(-1);
  if (!last) return { points, changePct };
  if (!Number.isFinite(live.usd) || live.usd < 0) {
    return { points, changePct };
  }
  if (!Number.isFinite(live.asOf) || live.asOf <= last.time) {
    return { points, changePct };
  }

  const next = [...points, { time: live.asOf, value: live.usd }];
  return { points: next, changePct: seriesChangePct(next) };
}

/** Liveline reads seconds; `/history` sends milliseconds. */
export function toChartSeconds(milliseconds: number): number {
  return milliseconds / 1000;
}

export function toChartPoints(
  points: readonly HistoryPoint[],
): LivelinePoint[] {
  return points.map((point) => ({
    time: toChartSeconds(point.time),
    value: point.value,
  }));
}

/**
 * The one conversion boundary for the card. Both the points and `asOf`
 * leave here in seconds, so a consumer cannot compare the line's last
 * timestamp with the series watermark and get a factor of 1000 wrong.
 */
export function toChartSeries(
  points: readonly HistoryPoint[],
  asOfMilliseconds: number | null,
): { points: LivelinePoint[]; asOf: number | null } {
  return {
    points: toChartPoints(points),
    asOf:
      asOfMilliseconds === null ? null : toChartSeconds(asOfMilliseconds),
  };
}

type HistoryBody = {
  points?: unknown;
  changePct?: unknown;
  source?: unknown;
  asOf?: unknown;
  incomplete?: unknown;
  stale?: unknown;
};

export type TokenSeriesData = {
  /** Wire points in milliseconds, exactly as `/history` sends them. */
  points: HistoryPoint[];
  changePct: number | null;
  source: TokenSeriesSource | null;
  /** Wire watermark in milliseconds; the hook returns it in seconds. */
  asOf: number | null;
  incomplete: boolean;
  stale: boolean;
};

function isSeriesSource(value: unknown): value is TokenSeriesSource {
  return typeof value === "string" && SERIES_SOURCES.has(value);
}

function readPoints(value: unknown): HistoryPoint[] {
  if (!Array.isArray(value)) return [];

  const points: HistoryPoint[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const { time, value: rawValue } = entry as {
      time?: unknown;
      value?: unknown;
    };
    if (
      typeof time !== "number" ||
      !Number.isFinite(time) ||
      time <= 0 ||
      typeof rawValue !== "number" ||
      !Number.isFinite(rawValue) ||
      rawValue < 0
    ) {
      continue;
    }
    points.push({ time, value: rawValue });
  }
  return points.sort((a, b) => a.time - b.time);
}

/**
 * One history read. The unsupported-asset body is a normal answer with no
 * points, not an error: the card has exactly one empty state to render.
 */
async function fetchTokenSeriesOnce(
  assetId: string,
  range: TokenSeriesRange = TOKEN_SERIES_RANGE,
  signal?: AbortSignal,
): Promise<TokenSeriesData> {
  const res = await fetch(tokenHistoryUrl(assetId, range), { signal });
  if (!res.ok) {
    throw new TokenSeriesError(
      `Price history is unavailable (${res.status}).`,
      res.status,
    );
  }

  const body = (await res.json().catch(() => null)) as HistoryBody | null;
  if (!body || typeof body !== "object") {
    throw new TokenSeriesError("Price history returned an unreadable response.");
  }

  const points = readPoints(body.points);
  const source = isSeriesSource(body.source) ? body.source : null;
  const asOf =
    typeof body.asOf === "number" &&
    Number.isFinite(body.asOf) &&
    body.asOf > 0
      ? body.asOf
      : (points.at(-1)?.time ?? null);
  const changePct =
    typeof body.changePct === "number" && Number.isFinite(body.changePct)
      ? body.changePct
      : seriesChangePct(points);

  return {
    points,
    changePct: points.length >= 2 ? changePct : null,
    source,
    asOf: points.length > 0 ? asOf : null,
    incomplete: body.incomplete === true,
    stale: body.stale === true,
  };
}

/**
 * One history read per asset and range, shared by the viewport warm-up and
 * the popup's query. A hover that lands before the prefetch resolves joins
 * the same request instead of issuing a second one.
 */
export function fetchTokenSeries(
  assetId: string,
  range: TokenSeriesRange = TOKEN_SERIES_RANGE,
  signal?: AbortSignal,
): Promise<TokenSeriesData> {
  const key = `${assetId}|${range}`;
  const existing = seriesInflight.get(key);
  if (existing) return existing;

  const pending = fetchTokenSeriesOnce(assetId, range, signal).finally(() => {
    if (seriesInflight.get(key) === pending) seriesInflight.delete(key);
  });
  seriesInflight.set(key, pending);
  return pending;
}

/**
 * Warm one ticker's 24-hour line before its card mounts. The chip calls this
 * when it enters (or re-enters) the viewport, so a hover opens onto a chart
 * that is already cached instead of starting a second lookup.
 *
 * The row is picked chain-strict: drawing one chain's line under another
 * chain's ticker would be a different asset. Failures are ignored because a
 * warm-up is best effort; the popup's own query owns its retry policy once
 * it opens.
 */
export function prefetchTokenSeriesForSymbol(
  symbol: string,
  chain?: string,
): Promise<void> {
  // Flag off means no Worker history request at all, matching the hook.
  if (!isPricesLive()) return Promise.resolve();
  const ticker = symbol.trim().toUpperCase();
  if (!ticker) return Promise.resolve();

  return resolveSymbolRows(ticker).then((rows) => {
    const asset = pickSymbolAssetForHistory(rows, chain);
    const assetId = asset?.assetId?.trim() ?? "";
    if (!assetId) return;
    if (freshPrefetchedSeries(assetId)) return;

    const existing = prefetchInflight.get(assetId);
    if (existing) return existing;

    const task = fetchTokenSeries(
      assetId,
      TOKEN_SERIES_RANGE,
      AbortSignal.timeout(PREFETCH_TIMEOUT_MS),
    )
      .then((data) => {
        prefetchedSeries.set(assetId, { data, at: Date.now() });
      })
      .catch(() => {
        // Best effort: the card retries when it opens.
      })
      .finally(() => {
        prefetchInflight.delete(assetId);
      });

    prefetchInflight.set(assetId, task);
    return task;
  });
}

/**
 * The `initialData` a card hands React Query for a prefetched line. Fresh
 * means "written within the query's own staleTime", so a popup that mounts
 * after a viewport warm-up paints the chart immediately and does not refetch
 * it inside the same half hour.
 */
export function tokenSeriesInitialData(
  assetId: string | null | undefined,
):
  | { initialData: TokenSeriesData; initialDataUpdatedAt: number }
  | undefined {
  const id = assetId?.trim() ?? "";
  if (!id) return undefined;
  const cached = freshPrefetchedSeries(id);
  if (!cached) return undefined;
  return { initialData: cached.data, initialDataUpdatedAt: cached.at };
}

export type TokenSeries = {
  /** Chart points in seconds, with the live quote joined when it matches. */
  points: LivelinePoint[];
  changePct: number | null;
  source: TokenSeriesSource | null;
  /** The newest observation in seconds, the same unit as `points`. */
  asOf: number | null;
  incomplete: boolean;
  stale: boolean;
  isLoading: boolean;
  error: Error | null;
};

/**
 * The 24-hour series for one asset.
 *
 * `enabled` is the card's own open state. The popup mounts only while it is
 * open, so a transcript full of chips never fetches a chart it did not ask
 * for. A missing asset id keeps the query off until the catalogue resolves
 * the ticker.
 */
export function useTokenSeries(
  assetId: string | null | undefined,
  enabled = true,
): TokenSeries {
  const id = assetId?.trim() ?? "";
  const range = TOKEN_SERIES_RANGE;
  // Flag off restores the catalogue path: no history request, no line, and
  // the card keeps its own metadata price with an empty chart.
  const liveSeries = tokenSeriesEnabled(id, enabled);

  // A freshly prefetched line seeds the query: the chart paints on the first
  // render and `initialDataUpdatedAt` keeps it inside the 30-minute
  // staleTime, so opening the card does not fetch the same series again.
  const prefetched = liveSeries ? tokenSeriesInitialData(id) : undefined;

  const query = useQuery<TokenSeriesData>({
    queryKey: tokenSeriesQueryKey(id || null, range),
    queryFn: ({ signal }) => {
      if (!id) throw new Error("A token series needs an asset id.");
      return fetchTokenSeries(id, range, signal);
    },
    enabled: liveSeries && id.length > 0,
    initialData: prefetched?.initialData,
    initialDataUpdatedAt: prefetched?.initialDataUpdatedAt,
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    // The app's QueryClient defaults to three retries. History needs its
    // own policy: never retry a 4xx, and retry an outage at most once.
    retry: shouldRetryTokenSeries,
  });

  // A disabled card owns its own series (or none at all). Exposing a cached
  // series here would let an explicit `history` prop inherit a percent from
  // a different line that once occupied the same key.
  const data = liveSeries ? query.data : undefined;

  const live = usePrice(liveSeries && id ? id : null);
  const merged = useMemo(
    () =>
      appendLivePoint(
        data?.points ?? EMPTY_HISTORY_POINTS,
        live,
        data?.source,
      ),
    [data, live],
  );
  const chart = useMemo(
    () =>
      toChartSeries(
        merged.points,
        merged.points.at(-1)?.time ?? data?.asOf ?? null,
      ),
    [merged.points, data?.asOf],
  );

  return {
    points: chart.points,
    // Derived from the same points the chart draws, so a percent can never
    // describe a line that is no longer on screen.
    changePct: merged.changePct ?? data?.changePct ?? null,
    source: data?.source ?? null,
    asOf: chart.asOf,
    incomplete: data?.incomplete ?? false,
    stale: data?.stale ?? false,
    isLoading: liveSeries && query.isLoading,
    error: liveSeries ? (query.error ?? null) : null,
  };
}

/** Clears the viewport warm-up cache. Never call this in the app. */
export function __resetTokenSeriesForTests(): void {
  prefetchedSeries.clear();
  prefetchInflight.clear();
  seriesInflight.clear();
}
