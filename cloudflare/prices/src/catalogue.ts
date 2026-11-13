import { describeError, parseJson } from "./probe";

/**
 * The catalogue is metadata, not a price feed. 1Click refreshes its prices as
 * a five-minute batch and the asset list itself changes rarely, so a six-hour
 * refresh keeps the registry current without a hot read.
 */
export const CATALOGUE_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * A failed catalogue fetch waits this long before the tick retries. Without
 * it a 1Click outage would spend an eight-second fetch on every tick, which
 * is longer than the whole price budget.
 */
export const CATALOGUE_BACKOFF_MS = 60_000;

/**
 * A refresh may delete rows only when the new registry is at least 80% of the
 * previous one. A truncated 1Click 200 must keep the old rows rather than
 * shrink the registry to a partial list. The first sync has nothing to
 * protect.
 */
export function shouldPruneAssets(
  previousCount: number,
  nextCount: number,
): boolean {
  if (nextCount <= 0) return false;
  if (previousCount <= 0) return true;
  // 80% as 4/5, compared with integers so the boundary is exact.
  return nextCount * 5 >= previousCount * 4;
}

/** The tolerant window for a cold isolate to pay TLS setup. */
const TIMEOUT_MS = 8_000;
const CATALOGUE_URL = "https://1click.chaindefuser.com/v0/tokens";

/** One catalogue row, normalized. `null` means the upstream omitted the field. */
export type RawAsset = {
  assetId: string;
  symbol: string;
  chain: string;
  contract: string | null;
  decimals: number;
  coingeckoId: string | null;
  price: number | null;
  priceUpdatedAt: number | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A real string with content, otherwise null. Empty strings carry no identity. */
function toText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function toNumeric(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Precision is a non-negative integer; a malformed value degrades to 0, not to NaN. */
function toDecimals(value: unknown): number {
  const parsed = toNumeric(value);
  if (parsed === null || !Number.isInteger(parsed) || parsed < 0) return 0;
  return parsed;
}

/** A price is optional, and a negative one is not a price. Zero is kept: upstream sent it. */
function toPrice(value: unknown): number | null {
  const parsed = toNumeric(value);
  if (parsed === null || parsed < 0) return null;
  return parsed;
}

/** The catalogue sends an ISO timestamp; keep epoch milliseconds for SQLite. */
function toTimestamp(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return null;
    // A value below the millisecond epoch is a Unix timestamp in seconds.
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value !== "string") return null;

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * The endpoint returns a flat array today (verified live) but the wrapper
 * shape has appeared elsewhere in 1Click, so both are accepted. A malformed
 * body is an empty catalogue rather than an exception: the caller keeps the
 * rows it already has.
 */
export function parseCatalogue(body: unknown): RawAsset[] {
  let rows: unknown[] | null = null;
  if (Array.isArray(body)) {
    rows = body;
  } else if (isRecord(body) && Array.isArray(body.data)) {
    rows = body.data;
  }
  if (rows === null) return [];

  const assets = new Map<string, RawAsset>();
  for (const row of rows) {
    if (!isRecord(row)) continue;

    const assetId = toText(row.assetId);
    const symbol = toText(row.symbol);
    if (assetId === null || symbol === null) continue;

    // An assetId is the database key, so a duplicate row replaces the earlier
    // one instead of writing the same asset twice.
    assets.set(assetId, {
      assetId,
      symbol,
      chain: toText(row.blockchain) ?? "",
      contract: toText(row.contractAddress),
      decimals: toDecimals(row.decimals),
      coingeckoId: toText(row.coingeckoId),
      price: toPrice(row.price),
      priceUpdatedAt: toTimestamp(row.priceUpdatedAt),
    });
  }
  return [...assets.values()];
}

/** Never throws: a failed refresh returns an empty list so the caller can serve stale rows. */
export async function fetchCatalogue(): Promise<RawAsset[]> {
  try {
    const response = await fetch(CATALOGUE_URL, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      console.error(`[prices] catalogue answered ${response.status}`);
      return [];
    }
    return parseCatalogue(parseJson(await response.text()));
  } catch (error) {
    console.error("[prices] catalogue fetch failed", describeError(error));
    return [];
  }
}
