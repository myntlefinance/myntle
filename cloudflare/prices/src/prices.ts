/**
 * The pure half of the price desk: quote freshness, merging, the snapshot
 * payload, the source order derived from a registry row, and the watched set.
 *
 * Nothing here touches a binding, storage, the network, or a timer, so the
 * whole module is exercised by the unit suite without a Workers runtime.
 */

import { ALIASES, type PriceSource } from "./registry";
import type { LiveSourceName } from "./sources/types";

export type LiveSource = LiveSourceName;

/**
 * A stored quote. The source label says exactly which one answered, and it is
 * never blended with another. `stale` is set when a refresh attempt failed;
 * age-based staleness is computed at read time so a stored quote needs no
 * rewrite to become stale.
 */
export type Quote = {
  usd: number;
  asOf: number;
  source: LiveSource;
  stale?: boolean;
};

/** What the HTTP and socket boundary hands out: freshness is always explicit. */
export type QuoteView = {
  usd: number;
  asOf: number;
  source: LiveSource;
  stale: boolean;
};

/**
 * How long a source's value is treated as current. A quote older than twice
 * its TTL is still served, marked stale, and is never replaced with zero.
 */
export const QUOTE_TTL_MS: Readonly<Record<LiveSource, number>> = {
  binance: 10_000,
  alchemy: 60_000,
  oneclick: 60_000,
};

/** How long an id seen on the HTTP path keeps the alarm at the fast cadence. */
export const RECENT_TTL_MS = 60_000;
/**
 * The demand set is bounded: a public client must not be able to grow it with
 * random ids and pin the alarm at the fast cadence.
 */
export const RECENT_MAX = 200;
/** Anyone watching: one tick per ten seconds. */
export const ACTIVE_INTERVAL_MS = 10_000;
/** The hot set only: one tick per thirty seconds. */
export const HOT_INTERVAL_MS = 30_000;

/**
 * The assets the interface paints first. They are refreshed even with no
 * client, so the first screen is never empty. One assetId per ticker, chosen
 * from the registry by `pickHotAssetIds`.
 */
export const HOT_SYMBOLS = ["BTC", "ETH", "SOL", "USDC", "USDT", "NEAR"] as const;

export function ttlForSource(source: LiveSource): number {
  return QUOTE_TTL_MS[source];
}

/** Milliseconds since the quote's own observation, never negative. */
export function quoteAge(quote: Quote, now: number): number {
  return Math.max(0, now - quote.asOf);
}

/** Past its TTL: the next refresh should fetch it. */
export function isFresh(quote: Quote, now: number): boolean {
  return quoteAge(quote, now) <= ttlForSource(quote.source);
}

/** Past twice its TTL: served, but marked stale at the boundary. */
export function isStale(quote: Quote, now: number): boolean {
  return quoteAge(quote, now) > 2 * ttlForSource(quote.source);
}

/**
 * Whether the next refresh should fetch this asset. A quote flagged `stale`
 * is always refreshed even inside its TTL: the flag means the last attempt
 * failed, so its age alone would wrongly present it as current.
 */
export function needsRefresh(quote: Quote | undefined, now: number): boolean {
  if (quote === undefined) return true;
  if (quote.stale === true) return true;
  return !isFresh(quote, now);
}

/**
 * The boundary shape. A stored failure flag survives even while the quote is
 * young, because "we tried and could not refresh" is different from "the last
 * value ages out".
 */
export function presentQuote(quote: Quote, now: number): QuoteView {
  return {
    usd: quote.usd,
    asOf: quote.asOf,
    source: quote.source,
    stale: quote.stale === true || isStale(quote, now),
  };
}

export type PricesView = {
  prices: Record<string, QuoteView | null>;
  /** The newest quote's observation time, or the read time when empty. */
  asOf: number;
  /** Cached quotes for ids the registry no longer lists; delete them. */
  removed: string[];
};

/**
 * The `/prices` body from the in-memory map. An id the registry does not
 * know is `null` even if an old quote is still cached: a delisted asset must
 * not keep answering with a price nobody can trade.
 */
export function presentPrices(
  wanted: readonly string[],
  quotes: ReadonlyMap<string, Quote>,
  known: ReadonlySet<string>,
  now: number,
): PricesView {
  const prices: Record<string, QuoteView | null> = {};
  const removed: string[] = [];
  let newest = 0;

  for (const assetId of wanted) {
    const quote = quotes.get(assetId);
    if (quote === undefined) {
      prices[assetId] = null;
      continue;
    }

    if (!known.has(assetId)) {
      removed.push(assetId);
      prices[assetId] = null;
      continue;
    }

    prices[assetId] = presentQuote(quote, now);
    if (quote.asOf > newest) newest = quote.asOf;
  }

  return { prices, asOf: newest > 0 ? newest : now, removed };
}

/**
 * The cached quotes the registry still lists, with freshness computed at read
 * time. A delisted id can linger in the in-memory map until the HTTP path
 * deletes it; diagnostics and the socket snapshot must not count it.
 */
export function liveQuotes(
  quotes: ReadonlyMap<string, Quote>,
  known: ReadonlySet<string>,
  now: number,
): { quotes: Record<string, QuoteView>; stale: number } {
  const out: Record<string, QuoteView> = {};
  let stale = 0;

  for (const assetId of [...known].sort()) {
    const quote = quotes.get(assetId);
    if (quote === undefined) continue;

    out[assetId] = presentQuote(quote, now);
    if (isStale(quote, now) || quote.stale === true) stale += 1;
  }

  return { quotes: out, stale };
}

export type QuoteUpdate = {
  usd: number;
  asOf: number;
  source: LiveSource;
};

export type MergeUpdate = {
  /** Quotes that answered in this batch, keyed by assetId. */
  quotes: ReadonlyMap<string, QuoteUpdate>;
  /** Ids that were attempted and did not answer. */
  failures: Iterable<string>;
};

function isUsableQuote(quote: QuoteUpdate): boolean {
  return (
    Number.isFinite(quote.usd) &&
    quote.usd >= 0 &&
    Number.isFinite(quote.asOf) &&
    quote.asOf > 0
  );
}

/**
 * Fold one batch into the in-memory map:
 *
 * - a quote that answered replaces the previous value and clears `stale`,
 * - an attempted id that failed keeps its previous value, marked stale,
 * - an attempted id with no previous value is dropped (never a zero),
 * - ids nobody touched are carried through unchanged.
 */
export function mergeQuotes(
  previous: ReadonlyMap<string, Quote>,
  update: MergeUpdate,
): Map<string, Quote> {
  const next = new Map(previous);

  for (const assetId of update.failures) {
    // A success for the same id wins; the caller should not send both, but a
    // quote is better evidence than a failure.
    if (update.quotes.has(assetId)) continue;

    const prior = previous.get(assetId);
    if (prior === undefined) {
      next.delete(assetId);
      continue;
    }
    next.set(assetId, { ...prior, stale: true });
  }

  for (const [assetId, quote] of update.quotes) {
    if (!isUsableQuote(quote)) {
      // A malformed answer is a failed refresh, not a $0.00 price.
      const prior = next.get(assetId);
      if (prior !== undefined) next.set(assetId, { ...prior, stale: true });
      continue;
    }

    next.set(assetId, {
      usd: quote.usd,
      asOf: quote.asOf,
      source: quote.source,
    });
  }

  return next;
}

/* -------------------------------------------------------------------------- */
/* Snapshot                                                                    */
/* -------------------------------------------------------------------------- */

export const SNAPSHOT_VERSION = 1;

/**
 * The one-row snapshot: every stored quote plus the last tick, so a restarted
 * object can answer before its first alarm. The age is the quote's own
 * `asOf`, not the write time.
 */
export type SnapshotPayload = {
  version: number;
  quotes: Record<string, Quote>;
  lastTickAt: number | null;
};

export function emptySnapshot(): SnapshotPayload {
  return { version: SNAPSHOT_VERSION, quotes: {}, lastTickAt: null };
}

export function encodeSnapshot(
  quotes: ReadonlyMap<string, Quote>,
  lastTickAt: number | null,
): string {
  const payload: SnapshotPayload = {
    version: SNAPSHOT_VERSION,
    quotes: Object.fromEntries(quotes),
    lastTickAt:
      typeof lastTickAt === "number" && Number.isFinite(lastTickAt)
        ? lastTickAt
        : null,
  };
  return JSON.stringify(payload);
}

function decodeQuote(value: unknown): Quote | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const row = value as Record<string, unknown>;
  const { usd, asOf, source } = row;

  if (typeof usd !== "number" || !Number.isFinite(usd) || usd < 0) return null;
  if (typeof asOf !== "number" || !Number.isFinite(asOf) || asOf <= 0) {
    return null;
  }
  if (source !== "binance" && source !== "alchemy" && source !== "oneclick") {
    return null;
  }

  const quote: Quote = { usd, asOf, source };
  if (row.stale === true) quote.stale = true;
  return quote;
}

/**
 * A payload that cannot be parsed, has the wrong shape, or carries an unknown
 * version is an empty snapshot: the feed starts from nothing and fills on the
 * next tick rather than trusting a half-written row.
 */
export function decodeSnapshot(raw: string | null | undefined): SnapshotPayload {
  if (raw === null || raw === undefined || raw.length === 0) {
    return emptySnapshot();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptySnapshot();
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return emptySnapshot();
  }

  const record = parsed as Record<string, unknown>;
  if (record.version !== SNAPSHOT_VERSION) return emptySnapshot();

  const rawQuotes = record.quotes;
  if (
    typeof rawQuotes !== "object" ||
    rawQuotes === null ||
    Array.isArray(rawQuotes)
  ) {
    return emptySnapshot();
  }

  const quotes: Record<string, Quote> = {};
  for (const [assetId, value] of Object.entries(rawQuotes)) {
    const quote = decodeQuote(value);
    if (quote !== null) quotes[assetId] = quote;
  }

  const lastTickAt =
    typeof record.lastTickAt === "number" &&
    Number.isFinite(record.lastTickAt) &&
    record.lastTickAt > 0
      ? record.lastTickAt
      : null;

  return { version: SNAPSHOT_VERSION, quotes, lastTickAt };
}

/* -------------------------------------------------------------------------- */
/* Sources                                                                     */
/* -------------------------------------------------------------------------- */

export type AssetSourceRow = {
  primarySource: PriceSource;
  binanceSymbol: string | null;
  alchemySymbol: string | null;
};

function hasText(value: string | null): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Rebuild the fallback plan from a registry row without a schema change:
 * the primary first, the other mapped live source second, and 1Click last
 * for everything that is not already 1Click-primary. This reproduces the
 * order `buildRegistry` wrote in Step 02.
 */
export function deriveSources(row: AssetSourceRow): LiveSource[] {
  const sources: LiveSource[] = [row.primarySource];

  if (row.primarySource === "binance") {
    if (hasText(row.alchemySymbol)) sources.push("alchemy");
  } else if (row.primarySource === "alchemy") {
    if (hasText(row.binanceSymbol)) sources.push("binance");
  }

  if (row.primarySource !== "oneclick") sources.push("oneclick");

  return [...new Set(sources)];
}

/* -------------------------------------------------------------------------- */
/* Hot set and watched set                                                     */
/* -------------------------------------------------------------------------- */

export type AssetIdentity = {
  assetId: string;
  symbol: string;
  chain: string;
};

function chainRank(chain: string): number {
  const normalized = chain.trim().toLowerCase();
  if (normalized === "near") return 0;
  if (normalized === "eth") return 1;
  return 2;
}

function compareRanks(
  left: readonly [number, number, number, string],
  right: readonly [number, number, number, string],
): number {
  if (left[0] !== right[0]) return left[0] - right[0];
  if (left[1] !== right[1]) return left[1] - right[1];
  if (left[2] !== right[2]) return left[2] - right[2];
  return left[3] < right[3] ? -1 : left[3] > right[3] ? 1 : 0;
}

/**
 * One assetId per hot ticker. The same ticker appears on many chains, so the
 * rule is: the canonical chain first (near, then eth), then the token's own
 * chain (SOL on sol, BTC on btc), an exact ticker over a 1:1 alias, and the
 * assetId last for a deterministic tie-break. NEAR has no exact row on the
 * near chain, so its wrapped alias wins there, which is exactly the identity
 * the registry prices as NEAR.
 */
export function pickHotAssetIds(
  rows: readonly AssetIdentity[],
  symbols: readonly string[] = HOT_SYMBOLS,
): string[] {
  const wanted = new Set(symbols.map((symbol) => symbol.toUpperCase()));
  const best = new Map<
    string,
    { assetId: string; rank: readonly [number, number, number, string] }
  >();

  for (const row of rows) {
    const raw = row.symbol.trim().toUpperCase();
    if (raw.length === 0) continue;

    const target = ALIASES[raw] ?? raw;
    if (!wanted.has(target)) continue;

    const chain = row.chain.trim().toLowerCase();
    const rank = [
      chainRank(row.chain),
      chain === raw.toLowerCase() ? 0 : 1,
      raw === target ? 0 : 1,
      row.assetId,
    ] as const;

    const incumbent = best.get(target);
    if (incumbent === undefined || compareRanks(rank, incumbent.rank) < 0) {
      best.set(target, { assetId: row.assetId, rank });
    }
  }

  const picked: string[] = [];
  for (const symbol of symbols) {
    const match = best.get(symbol.toUpperCase());
    if (match !== undefined) picked.push(match.assetId);
  }
  return picked;
}

/**
 * The tickers to ask the assets table for: the hot symbols plus every alias
 * that maps onto one, so a wrapped row can be discovered without scanning the
 * whole catalogue.
 */
export function hotQuerySymbols(
  symbols: readonly string[] = HOT_SYMBOLS,
): string[] {
  const wanted = new Set(symbols.map((symbol) => symbol.toUpperCase()));
  const out = new Set<string>(wanted);
  for (const [alias, target] of Object.entries(ALIASES)) {
    if (wanted.has(target)) out.add(alias);
  }
  return [...out];
}

/**
 * Drop recent ids past their TTL, then keep only the newest `max` entries.
 * Expiry is the primary bound; the cap keeps a burst of distinct requests
 * from growing the map without limit.
 */
export function pruneRecent(
  recent: ReadonlyMap<string, number>,
  now: number,
  max = RECENT_MAX,
): Map<string, number> {
  const live: [string, number][] = [];
  for (const [assetId, at] of recent) {
    if (now - at < RECENT_TTL_MS) live.push([assetId, at]);
  }

  if (live.length <= max) return new Map(live);

  live.sort((left, right) => {
    if (right[1] !== left[1]) return right[1] - left[1];
    return left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0;
  });
  return new Map(live.slice(0, max));
}

/**
 * Record a request against the demand set, but only for ids the registry
 * knows. An unknown id is not demand: it has no price to keep warm, and a
 * public caller could otherwise fill the map with noise.
 */
export function trackRecent(
  recent: ReadonlyMap<string, number>,
  ids: readonly string[],
  known: ReadonlySet<string>,
  now: number,
): Map<string, number> {
  const next = new Map(recent);
  for (const assetId of ids) {
    if (known.has(assetId)) next.set(assetId, now);
  }
  return pruneRecent(next, now);
}

/**
 * The watched set is the union of the hot set, the ids recently requested
 * over HTTP, and (from Step 05) the ids attached to sockets. It is sorted so
 * a log line and a health payload do not churn with map insertion order.
 */
export function watchedAssets(input: {
  hot: readonly string[];
  recent: ReadonlyMap<string, number>;
  extra?: readonly string[];
  now: number;
}): string[] {
  const ids = new Set<string>(input.hot);
  for (const assetId of input.extra ?? []) ids.add(assetId);
  for (const assetId of pruneRecent(input.recent, input.now).keys()) {
    ids.add(assetId);
  }
  return [...ids].sort();
}

/** 10s while someone is watching, 30s for the hot set alone. */
export function intervalMs(recentActive: boolean): number {
  return recentActive ? ACTIVE_INTERVAL_MS : HOT_INTERVAL_MS;
}

/**
 * The alarm time to report. During a tick, `getAlarm()` is null until the
 * handler reschedules, so fall back to the last tick plus the computed
 * interval rather than reporting nothing. Before the first tick there is no
 * last tick, so the estimate starts from now.
 */
export function scheduledAlarmAt(input: {
  alarmAt: number | null;
  lastTickAt: number | null;
  intervalMs: number;
  now: number;
}): number {
  if (input.alarmAt !== null) return input.alarmAt;
  return (input.lastTickAt ?? input.now) + input.intervalMs;
}

/**
 * Whether the tick should attempt a catalogue refresh. A failed fetch sets a
 * backoff, so an upstream outage is retried once a minute rather than on
 * every tick; a success is governed by the six-hour TTL.
 */
export function catalogueDue(input: {
  now: number;
  syncedAt: number | null;
  backoffUntil: number;
  ttlMs: number;
}): boolean {
  if (input.now < input.backoffUntil) return false;
  if (input.syncedAt === null) return true;
  return input.now - input.syncedAt >= input.ttlMs;
}
