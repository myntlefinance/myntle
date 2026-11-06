"use client";

import { useEffect, useSyncExternalStore } from "react";

type AssetRow = {
  assetId: string;
  symbol: string;
  chain: string;
  priceUsd?: number;
};

/** Price cache keyed by ticker and chain, so a card asks once. */
const cache = new Map<string, number | null>();
/** One request per ticker, even when several cards ask at the same time. */
const inflight = new Map<string, Promise<AssetRow[]>>();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setCached(key: string, price: number | null) {
  cache.set(key, price);
  notify();
}

function request(symbol: string): Promise<AssetRow[]> {
  const existing = inflight.get(symbol);
  if (existing) return existing;

  const pending = fetch(
    `/api/assets?symbols=${encodeURIComponent(symbol)}`,
  )
    .then((res) => (res.ok ? res.json() : null))
    .then((body: { assets?: AssetRow[] } | null) =>
      Array.isArray(body?.assets) ? body.assets : [],
    )
    .catch(() => [])
    .finally(() => {
      inflight.delete(symbol);
    });

  inflight.set(symbol, pending);
  return pending;
}

function cacheKey(symbol: string, chain?: string): string {
  return `${symbol}|${chain?.toLowerCase() ?? ""}`;
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
    const wanted = chain.toLowerCase();
    const match = priced.find(
      (asset) => asset.chain.toLowerCase() === wanted,
    );
    if (match) return match.priceUsd;
  }
  return priced[0].priceUsd;
}

/** Warm the price before the card opens. The chip calls this on hover
 * intent, so the title has a figure by the time the card paints. */
export function prefetchSymbolPrice(symbol: string, chain?: string): void {
  const ticker = symbol.trim().toUpperCase();
  if (!ticker) return;
  const key = cacheKey(ticker, chain);
  if (cache.has(key)) return;

  void request(ticker).then((assets) => {
    setCached(key, pickSymbolPrice(assets, chain) ?? null);
  });
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
  const ticker = symbol?.trim().toUpperCase() ?? "";
  const key = ticker ? cacheKey(ticker, chain) : "";

  useEffect(() => {
    if (!ticker || cache.has(key)) return;
    let cancelled = false;

    void request(ticker).then((assets) => {
      if (cancelled) return;
      setCached(key, pickSymbolPrice(assets, chain) ?? null);
    });

    return () => {
      cancelled = true;
    };
  }, [ticker, chain, key]);

  const price = useSyncExternalStore(
    subscribe,
    () => cache.get(key),
    () => undefined,
  );

  return price ?? undefined;
}
