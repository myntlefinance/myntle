"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { chainCandidates } from "./liveSnapshot";
import { seedQuote, type LiveQuote } from "./priceStore";
import { usePrice, usePriceSubscription } from "./usePrice";
import { isPricesLive } from "@/lib/prices/flags";

export type AssetRow = {
  assetId: string;
  symbol: string;
  chain: string;
  priceUsd?: number;
  priceAsOf?: number;
  contractAddress?: string | null;
};

/** The catalogue is metadata, not a tick: five minutes is plenty. */
const ROW_TTL_MS = 5 * 60_000;
/** A failed lookup retries sooner than a real one, without a fetch storm. */
const EMPTY_ROW_TTL_MS = 30_000;

type RowCacheEntry = { rows: AssetRow[]; at: number };

/** Rows keyed by ticker, so a card asks once even when several render. */
const rowCache = new Map<string, RowCacheEntry>();
/** One request per ticker, shared by every card asking at the same time. */
const inflight = new Map<string, Promise<AssetRow[]>>();
const listeners = new Set<() => void>();
const EMPTY_ROWS: AssetRow[] = [];
let metaVersion = 0;

function notify(): void {
  metaVersion += 1;
  for (const listener of [...listeners]) listener();
}

function subscribeMeta(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getMetaVersion(): number {
  return metaVersion;
}

function getServerMetaVersion(): number {
  return 0;
}

function rowTtl(entry: RowCacheEntry): number {
  return entry.rows.length === 0 ? EMPTY_ROW_TTL_MS : ROW_TTL_MS;
}

function request(symbol: string): Promise<AssetRow[]> {
  const cached = rowCache.get(symbol);
  if (cached && Date.now() - cached.at < rowTtl(cached)) {
    return Promise.resolve(cached.rows);
  }

  const existing = inflight.get(symbol);
  if (existing) return existing;

  const pending = fetch(`/api/assets?symbols=${encodeURIComponent(symbol)}`)
    .then((res) => (res.ok ? res.json() : null))
    .then((body: { assets?: AssetRow[] } | null) => {
      const rows = Array.isArray(body?.assets)
        ? body.assets.filter(
            (row) =>
              row &&
              typeof row.assetId === "string" &&
              typeof row.symbol === "string" &&
              typeof row.chain === "string",
          )
        : [];
      rowCache.set(symbol, { rows, at: Date.now() });
      notify();
      return rows;
    })
    .catch(() => {
      rowCache.set(symbol, { rows: [], at: Date.now() });
      notify();
      return [] as AssetRow[];
    })
    .finally(() => {
      inflight.delete(symbol);
    });

  inflight.set(symbol, pending);
  return pending;
}

/** The chain the card is showing, expressed in the catalogue's spellings. */
function chainMatches(assetChain: string, chain?: string): boolean {
  if (!chain) return false;
  const wanted = chainCandidates(chain);
  return wanted.includes(assetChain.toLowerCase());
}

/** Pick the catalogue row the card is about: chain first, then price. */
export function pickSymbolAsset(
  assets: AssetRow[],
  chain?: string,
): AssetRow | undefined {
  if (assets.length === 0) return undefined;

  if (chain) {
    const match = assets.find((asset) => chainMatches(asset.chain, chain));
    if (match) return match;
  }

  const priced = assets.find(
    (asset) =>
      typeof asset.priceUsd === "number" && Number.isFinite(asset.priceUsd),
  );
  return priced ?? assets[0];
}

/**
 * Pick the catalogue row for the history line.
 *
 * A named chain is a hard requirement here, unlike `pickSymbolAsset`'s price
 * fallback: drawing one chain's token under another chain's label would be a
 * different asset. With no chain named, the ordinary pick still applies.
 */
export function pickSymbolAssetForHistory(
  assets: AssetRow[],
  chain?: string,
): AssetRow | undefined {
  if (!chain) return pickSymbolAsset(assets);
  return assets.find((asset) => chainMatches(asset.chain, chain));
}

/** Pick the chain the card is showing when the catalogue has it; otherwise
 * use the first priced match for the ticker. */
export function pickSymbolPrice(
  assets: AssetRow[],
  chain?: string,
): number | undefined {
  const priced = assets.filter(
    (asset) =>
      typeof asset.priceUsd === "number" && Number.isFinite(asset.priceUsd),
  );
  if (priced.length === 0) return undefined;

  if (chain) {
    const match = priced.find((asset) => chainMatches(asset.chain, chain));
    if (match) return match.priceUsd;
  }
  return priced[0].priceUsd;
}

/** The live quote wins; the catalogue price is the honest fallback. */
export function resolveSymbolPrice(
  asset: { priceUsd?: number } | undefined,
  quote: LiveQuote | undefined,
): number | undefined {
  if (quote && Number.isFinite(quote.usd)) return quote.usd;
  return asset?.priceUsd;
}

/**
 * The catalogue row and unit price for a ticker.
 *
 * `assetId` follows the price fallback: when the named chain has no row it
 * may resolve to another chain's token so the card still has a figure.
 * `historyAssetId` is chain-strict, so a chart is never drawn from a
 * different chain's asset. Both are the same row when the chain matches.
 *
 * This does not subscribe to the socket by itself: a card that is mounted
 * and visible can use `useVisiblePrice`, and the plain `useSymbolPrice`
 * below keeps the old eager behavior for callers that need it.
 */
export function useSymbolAsset(
  symbol: string | null,
  chain?: string,
): {
  assetId: string | undefined;
  historyAssetId: string | undefined;
  priceUsd: number | undefined;
  quote: LiveQuote | undefined;
} {
  const ticker = symbol?.trim().toUpperCase() ?? "";
  const version = useSyncExternalStore(
    subscribeMeta,
    getMetaVersion,
    getServerMetaVersion,
  );

  useEffect(() => {
    if (!ticker) return;
    const cached = rowCache.get(ticker);
    if (cached && Date.now() - cached.at < rowTtl(cached)) return;
    void request(ticker);
  }, [ticker]);

  const rows = rowCache.get(ticker)?.rows ?? EMPTY_ROWS;
  const asset = useMemo(
    () => pickSymbolAsset(rows, chain),
    // `version` re-reads the row cache when a request lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, chain, version],
  );
  const historyAsset = useMemo(
    () => pickSymbolAssetForHistory(rows, chain),
    // `version` re-reads the row cache when a request lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, chain, version],
  );
  const fallbackPrice = useMemo(
    () => pickSymbolPrice(rows, chain),
    // `version` re-reads the row cache when a request lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, chain, version],
  );

  const quote = usePrice(isPricesLive() ? asset?.assetId : null);

  return {
    assetId: asset?.assetId,
    historyAssetId: historyAsset?.assetId,
    priceUsd: resolveSymbolPrice(asset, quote) ?? fallbackPrice,
    quote,
  };
}

/** Warm the price before the card opens. The chip calls this on hover
 * intent, so the title has a figure by the time the card paints. */
export function prefetchSymbolPrice(symbol: string, chain?: string): void {
  const ticker = symbol.trim().toUpperCase();
  if (!ticker) return;

  void request(ticker).then((assets) => {
    const asset = pickSymbolAsset(assets, chain);
    if (!asset) return;
    if (
      isPricesLive() &&
      typeof asset.priceUsd === "number" &&
      Number.isFinite(asset.priceUsd) &&
      asset.priceUsd > 0
    ) {
      // Seed the store so the live reader has a figure before the socket
      // answers, but do not hold a subscription for a card that may never
      // open. The seed never overwrites a real quote. With the flag off the
      // card reads the catalogue row directly, so there is nothing to seed.
      seedQuote(
        asset.assetId,
        asset.priceUsd,
        asset.priceAsOf ?? Date.now(),
        "oneclick",
        true,
      );
    }
  });
}

/**
 * The catalogue rows for a ticker, through the hook's own cache and in-flight
 * request. A warm-up path and a mounted popup therefore share one metadata
 * fetch rather than racing each other.
 */
export function resolveSymbolRows(symbol: string): Promise<AssetRow[]> {
  const ticker = symbol.trim().toUpperCase();
  if (!ticker) return Promise.resolve([]);
  return request(ticker);
}

/**
 * Resolves a ticker to its catalogue unit price without trusting the model
 * to supply a figure. The hook runs only when a card opens, so a transcript
 * full of asset mentions does not fetch prices nobody looked at.
 */
export function useSymbolPrice(
  symbol: string | null,
  chain?: string,
): number | undefined {
  const asset = useSymbolAsset(symbol, chain);
  usePriceSubscription(asset.assetId ? [asset.assetId] : []);
  return asset.priceUsd;
}

/** Clears the metadata cache. Never call this in the app. */
export function __resetAssetPriceForTests(): void {
  rowCache.clear();
  inflight.clear();
  listeners.clear();
  metaVersion = 0;
}
