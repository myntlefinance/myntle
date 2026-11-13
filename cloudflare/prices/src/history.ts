/**
 * The pure half of the history endpoint: the cache key and TTLs, the
 * normalize/dedupe pass, the percent move, the no-history shape, and the
 * encode/decode of one `series` row.
 *
 * Nothing here touches storage, the network, or a timer, so the whole module
 * is exercised by the unit suite without a Workers runtime.
 */

import {
  changePct,
  downsampleTo,
  normalizePoints,
  SERIES_POINTS,
} from "./series";
import type { SeriesPoint, SourceName } from "./sources/types";

export { changePct };

/** The only range v1 serves. The schema leaves room for 7d/30d later. */
export const SERIES_RANGE = "24h";
export type SeriesRange = typeof SERIES_RANGE;

/** Binance and Alchemy history is reused for half an hour. */
export const SERIES_CACHE_TTL_MS = 30 * 60_000;
/**
 * CoinGecko's free/demo tier is rate-limited, so its history is reused for an
 * hour rather than half an hour. The source label on the row decides which TTL
 * applies on read.
 */
export const SERIES_COINGECKO_CACHE_TTL_MS = 60 * 60_000;
/**
 * A no-history answer is cached briefly, so a card that reopens does not hammer
 * three upstreams, while a transient outage is retried a minute later.
 */
export const SERIES_NEGATIVE_TTL_MS = 60_000;

/** `none` is the stored source of a negative row; it is never served. */
export type SeriesRowSource = SourceName | "none";

/** One `series` row after decode. Points are sorted, deduped, and capped. */
export type SeriesRow = {
  assetId: string;
  range: SeriesRange;
  points: SeriesPoint[];
  changePct: number | null;
  source: SeriesRowSource;
  fetchedAt: number;
  /**
   * Transient, never persisted: set when a failed refetch falls back to the
   * previous good points, so the boundary can say the line is old.
   */
  stale?: boolean;
};

/** The known-asset body: every number the chart needs and nothing else. */
export type HistorySeries = {
  assetId: string;
  range: SeriesRange;
  points: SeriesPoint[];
  changePct: number | null;
  source: SourceName;
  /** The newest observation, not the fetch time. */
  asOf: number;
  /** True when the source honestly returned fewer than 48 points. */
  incomplete: boolean;
  /** Present and true only when the last refetch failed and the old line is served. */
  stale?: boolean;
};

/** The unsupported-asset body. The card renders its own empty state. */
export type NoHistory = {
  assetId: string;
  range: SeriesRange;
  points: SeriesPoint[];
  reason: "no-history";
};

export type HistoryResponse = HistorySeries | NoHistory;

/** The raw SQLite row, before validation. */
export type SeriesRowRecord = {
  asset_id: string;
  range: string;
  points: string;
  change_pct: number | null;
  source: string;
  fetched_at: number;
};

/** The one range the route accepts; anything else is a 400 at the boundary. */
export function isSupportedRange(value: string | null): value is SeriesRange {
  return value === SERIES_RANGE;
}

/**
 * The in-flight key. The null byte cannot appear in a validated asset id or a
 * range, so two different pairs can never collide.
 */
export function seriesCacheKey(
  assetId: string,
  range: SeriesRange,
): string {
  return `${assetId}\u0000${range}`;
}

/**
 * Sort ascending, dedupe by timestamp, drop anything that is not a real
 * observation, then cap at the 48-point contract. A short answer is kept as it
 * arrived: `incomplete` says so, and no point is ever invented to fill a gap.
 */
export function normalizeSeries(points: readonly SeriesPoint[]): {
  points: SeriesPoint[];
  incomplete: boolean;
} {
  const normalized = downsampleTo(normalizePoints(points), SERIES_POINTS);
  return {
    points: normalized,
    incomplete: normalized.length < SERIES_POINTS,
  };
}

/** The negative row written after a source walk found no history. */
export function negativeSeriesRow(
  assetId: string,
  range: SeriesRange,
  fetchedAt: number,
): SeriesRow {
  return {
    assetId,
    range,
    points: [],
    changePct: null,
    source: "none",
    fetchedAt,
  };
}

export type SeriesFailureOutcome = {
  row: SeriesRow;
  /** False when the previous good row must be left in place. */
  write: boolean;
};

/**
 * The failed-refetch decision. A previous good series is served as it was,
 * marked stale, and the stored row is left untouched; a negative row is only
 * written when there is no series to keep. The next request retries upstream
 * (the breaker bounds a real outage), rather than replacing a real line with
 * an empty one.
 */
export function failedSeriesRow(input: {
  assetId: string;
  range: SeriesRange;
  previous: SeriesRow | null;
  fetchedAt: number;
}): SeriesFailureOutcome {
  const previous = input.previous;
  if (
    previous !== null &&
    previous.source !== "none" &&
    previous.points.length > 0
  ) {
    return { row: { ...previous, stale: true }, write: false };
  }

  return {
    row: negativeSeriesRow(input.assetId, input.range, input.fetchedAt),
    write: true,
  };
}

/**
 * The one builder a successful resolver call uses. The percent move is
 * derived from the stored points, so the number and the line always agree.
 */
export function buildSeriesRow(input: {
  assetId: string;
  range: SeriesRange;
  points: readonly SeriesPoint[];
  source: SourceName;
  fetchedAt: number;
}): SeriesRow {
  const normalized = normalizeSeries(input.points);
  return {
    assetId: input.assetId,
    range: input.range,
    points: normalized.points,
    changePct: changePct(normalized.points),
    source: input.source,
    fetchedAt: input.fetchedAt,
  };
}

/**
 * How long a row may be served before the next fetch. CoinGecko is the
 * rate-limited history source, so its line is kept twice as long; a negative
 * row keeps the short retry window.
 */
export function seriesCacheTtlMs(source: SeriesRowSource): number {
  if (source === "none") return SERIES_NEGATIVE_TTL_MS;
  if (source === "coingecko") return SERIES_COINGECKO_CACHE_TTL_MS;
  return SERIES_CACHE_TTL_MS;
}

/** A row is fresh strictly inside its TTL; the boundary itself is stale. */
export function isSeriesFresh(row: SeriesRow, now: number): boolean {
  const age = Math.max(0, now - row.fetchedAt);
  return age < seriesCacheTtlMs(row.source);
}

/** The `points` column. Only the two fields the chart reads are stored. */
export function encodeSeriesPoints(points: readonly SeriesPoint[]): string {
  return JSON.stringify(
    points.map((point) => ({ time: point.time, value: point.value })),
  );
}

type DecodedPoints = { points: SeriesPoint[]; trimmed: boolean };

function decodePoints(raw: string): DecodedPoints | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const points: SeriesPoint[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      continue;
    }
    const row = entry as Record<string, unknown>;
    if (typeof row.time !== "number" || typeof row.value !== "number") continue;
    points.push({ time: row.time, value: row.value });
  }

  // A malformed entry is dropped; a fully invalid list becomes the negative
  // shape rather than an invented line. A legacy or corrupt row wider than the
  // chart contract is trimmed to the newest 48 by time, never served whole.
  const normalized = normalizePoints(points);
  if (normalized.length > SERIES_POINTS) {
    return { points: normalized.slice(-SERIES_POINTS), trimmed: true };
  }
  return { points: normalized, trimmed: false };
}

function decodeSource(
  raw: string,
  empty: boolean,
): SeriesRowSource | null {
  // A negative row carries no source; an empty row with a real source is a
  // half-written row, not a series. A row with points must name the source
  // that produced them, because the TTL depends on it.
  if (empty) return raw === "none" ? "none" : null;
  if (raw === "binance" || raw === "alchemy" || raw === "coingecko") {
    return raw;
  }
  return null;
}

/**
 * A row that cannot be parsed or fails validation is null, and the caller
 * fetches again. A corrupt cache must never be served as a real series.
 */
export function decodeSeriesRow(
  record: SeriesRowRecord | null | undefined,
): SeriesRow | null {
  if (record === null || record === undefined) return null;

  const assetId =
    typeof record.asset_id === "string" ? record.asset_id.trim() : "";
  if (assetId.length === 0) return null;
  if (record.range !== SERIES_RANGE) return null;
  if (
    typeof record.fetched_at !== "number" ||
    !Number.isFinite(record.fetched_at) ||
    record.fetched_at <= 0
  ) {
    return null;
  }
  if (typeof record.points !== "string") return null;

  const decoded = decodePoints(record.points);
  if (decoded === null) return null;
  const points = decoded.points;

  const source = decodeSource(record.source, points.length === 0);
  if (source === null) return null;

  // The stored percent is a cache of the points. A trimmed legacy row must
  // recompute it, or the number would describe the wider line that was cut.
  const stored = record.change_pct;
  const pct =
    !decoded.trimmed &&
    typeof stored === "number" &&
    Number.isFinite(stored)
      ? stored
      : changePct(points);

  return {
    assetId,
    range: SERIES_RANGE,
    points,
    changePct: pct,
    source,
    fetchedAt: record.fetched_at,
  };
}

/** The unsupported shape, used for an unknown id and for a negative row. */
export function noHistory(
  assetId: string,
  range: SeriesRange,
): NoHistory {
  return { assetId, range, points: [], reason: "no-history" };
}

/**
 * The boundary shape for a stored row. A negative row is the same body an
 * unknown asset gets, so the card has exactly one empty case to render.
 */
export function presentHistory(row: SeriesRow): HistoryResponse {
  if (row.source === "none" || row.points.length === 0) {
    return noHistory(row.assetId, row.range);
  }

  const body: HistorySeries = {
    assetId: row.assetId,
    range: row.range,
    points: row.points,
    changePct: row.changePct ?? changePct(row.points),
    source: row.source,
    asOf: row.points.at(-1)?.time ?? row.fetchedAt,
    incomplete: row.points.length < SERIES_POINTS,
  };
  if (row.stale === true) body.stale = true;
  return body;
}
