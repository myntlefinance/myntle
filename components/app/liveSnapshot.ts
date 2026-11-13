"use client";

import { useEffect, useMemo, useState } from "react";
import {
  isIntentsGroupName,
  type AssetGroup,
  type AssetItem,
} from "@/lib/wallet/balances";
import type { PortfolioSnapshot } from "./portfolioCache";
import { seedQuotes, type LiveQuote } from "./priceStore";
import { usePriceMap, usePriceSubscription } from "./usePrice";
import { isPricesLive } from "@/lib/prices/flags";

/* ─────────────────────────────────────────────────────────
 * LIVE SNAPSHOT
 * A portfolio is read every few minutes; its prices should not be.
 * This module overlays the live store on a settled snapshot, and
 * resolves each row's ticker and chain to the catalogue's assetId.
 * The server balance types now carry `assetId`, `quantity`, and
 * `priceAsOf`; a snapshot cached before them still resolves by
 * ticker, chain, and contract.
 * ───────────────────────────────────────────────────────── */

type LiveAssetItem = AssetItem & { assetId?: string };

export type AssetLookupRow = {
  assetId: string;
  symbol: string;
  chain: string;
  priceUsd?: number;
  priceAsOf?: number;
  contractAddress?: string | null;
};

export type ResolveAssetId = (item: AssetItem) => string | undefined;

/**
 * The catalogue spells a chain differently from the wallet adapter.
 * `eth` and `ethereum` are the same chain; `pol` and `polygon` are;
 * `intents` is a NEAR balance held for settlement, not a new chain.
 */
const CHAIN_ALIASES: Record<string, string[]> = {
  near: ["near", "intents"],
  intents: ["near", "intents"],
  eth: ["eth"],
  ethereum: ["eth"],
  "eth-mainnet": ["eth"],
  sol: ["sol"],
  solana: ["sol"],
  "solana-mainnet": ["sol"],
  base: ["base"],
  "base-mainnet": ["base"],
  arb: ["arb"],
  arbitrum: ["arb"],
  "arb-mainnet": ["arb"],
  op: ["op"],
  opt: ["op"],
  optimism: ["op"],
  "opt-mainnet": ["op"],
  pol: ["pol", "matic"],
  polygon: ["pol", "matic"],
  matic: ["pol", "matic"],
  "polygon-mainnet": ["pol", "matic"],
  "matic-mainnet": ["pol", "matic"],
  bnb: ["bsc", "bnb"],
  bsc: ["bsc", "bnb"],
  "bnb-mainnet": ["bsc", "bnb"],
  avax: ["avax"],
  avalanche: ["avax"],
  "avax-mainnet": ["avax"],
  gnosis: ["gnosis"],
  "gnosis-mainnet": ["gnosis"],
  linea: ["linea"],
  "linea-mainnet": ["linea"],
  scroll: ["scroll"],
  "scroll-mainnet": ["scroll"],
  zksync: ["zksync"],
  "zksync-mainnet": ["zksync"],
  blast: ["blast"],
  "blast-mainnet": ["blast"],
  mantle: ["mantle"],
  "mantle-mainnet": ["mantle"],
  celo: ["celo"],
  "celo-mainnet": ["celo"],
  unichain: ["unichain"],
  "unichain-mainnet": ["unichain"],
  soneium: ["soneium"],
  "soneium-mainnet": ["soneium"],
  aptos: ["aptos"],
  sui: ["sui"],
  btc: ["btc"],
  bitcoin: ["btc"],
  tron: ["tron"],
  ton: ["ton"],
  stellar: ["stellar"],
  cardano: ["cardano"],
  ltc: ["ltc"],
  bch: ["bch"],
  doge: ["doge"],
  xrp: ["xrp"],
  zec: ["zec"],
};

/** Every catalogue spelling a wallet chain might mean. */
export function chainCandidates(chain?: string | null): string[] {
  if (!chain) return [];
  const key = chain.trim().toLowerCase();
  if (!key) return [];
  const aliases = CHAIN_ALIASES[key];
  return aliases ? [...new Set([key, ...aliases])] : [key];
}

const ASSET_ID_PREFIXES = ["nep141:", "nep245:", "1cs_v1:", "erc20:"];

function looksLikeAssetId(value: string): boolean {
  const lower = value.toLowerCase();
  return ASSET_ID_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

function round2(value: number): number {
  return Number.parseFloat(value.toFixed(2));
}

function sumGroups(groups: readonly AssetGroup[]): number {
  let total = 0;
  for (const group of groups) {
    for (const item of group.items) {
      if (Number.isFinite(item.valueUsd)) total += item.valueUsd;
    }
  }
  return total;
}

function updatedItem(item: AssetItem, quote: LiveQuote): AssetItem {
  // A broken quote or a broken prior value must never turn a total into
  // NaN. Leave the row exactly as the server settled it.
  if (!Number.isFinite(quote.usd)) return item;
  if (!Number.isFinite(item.valueUsd)) return item;

  let valueUsd = item.valueUsd;

  // The quantity is the exact figure the server derived from the raw
  // balance, so it beats scaling the stored value by a ratio.
  if (typeof item.quantity === "number" && Number.isFinite(item.quantity)) {
    valueUsd = item.quantity * quote.usd;
  } else if (
    typeof item.priceUsd === "number" &&
    Number.isFinite(item.priceUsd) &&
    item.priceUsd > 0
  ) {
    valueUsd = item.valueUsd * (quote.usd / item.priceUsd);
  } else {
    const amount = Number.parseFloat(item.amount.replace(/,/g, ""));
    if (Number.isFinite(amount)) valueUsd = amount * quote.usd;
  }

  const nextValue = Number.isFinite(valueUsd)
    ? round2(valueUsd)
    : item.valueUsd;
  if (item.priceUsd === quote.usd && item.valueUsd === nextValue) return item;
  return { ...item, priceUsd: quote.usd, valueUsd: nextValue };
}

function rebuildGroups(
  groups: readonly AssetGroup[],
  updates: ReadonlyMap<string, AssetItem>,
): { groups: AssetGroup[]; changed: boolean } {
  let changed = false;
  const next = groups.map((group) => {
    let groupChanged = false;
    const items = group.items.map((item) => {
      const updated = updates.get(item.id) ?? item;
      if (updated !== item) groupChanged = true;
      return updated;
    });
    if (!groupChanged) return group;
    changed = true;
    return { ...group, items };
  });
  return { groups: changed ? next : [...groups], changed };
}

/**
 * Overlays live quotes onto a settled portfolio snapshot.
 *
 * The value is scaled from the stored unit price when there is one, so a
 * row keeps the quantity the server already calculated. A row with no
 * stored price falls back to its amount, with the separators removed.
 * Nothing changed means the original snapshot is returned by reference,
 * which keeps React and the query cache quiet.
 */
export function applyLivePrices(
  snapshot: PortfolioSnapshot,
  quotes: ReadonlyMap<string, LiveQuote>,
  resolve: ResolveAssetId = (item) => (item as LiveAssetItem).assetId,
): PortfolioSnapshot {
  // Flag off restores the catalogue path exactly: a snapshot is the settled
  // server payload, unchanged by reference so React sees no update.
  if (!isPricesLive() || quotes.size === 0) return snapshot;

  const updates = new Map<string, AssetItem>();

  const collect = (groups: readonly AssetGroup[]) => {
    for (const group of groups) {
      for (const item of group.items) {
        if (updates.has(item.id)) continue;
        const assetId = resolve(item) ?? (item as LiveAssetItem).assetId;
        const quote = assetId ? quotes.get(assetId) : undefined;
        updates.set(item.id, quote ? updatedItem(item, quote) : item);
      }
    }
  };

  collect(snapshot.groups);
  if (snapshot.walletGroups) collect(snapshot.walletGroups);
  if (snapshot.superGroups) collect(snapshot.superGroups);

  const walletSource =
    snapshot.walletGroups ??
    snapshot.groups.filter((group) => !isIntentsGroupName(group.name));
  const superSource =
    snapshot.superGroups ??
    snapshot.groups.filter((group) => isIntentsGroupName(group.name));

  const groups = rebuildGroups(snapshot.groups, updates);
  const wallet = rebuildGroups(walletSource, updates);
  const superGroups = rebuildGroups(superSource, updates);

  if (!groups.changed && !wallet.changed && !superGroups.changed) {
    return snapshot;
  }

  const walletUsd = round2(sumGroups(wallet.groups));
  const superUsd = round2(sumGroups(superGroups.groups));

  return {
    ...snapshot,
    groups: groups.groups,
    ...(snapshot.walletGroups !== undefined
      ? { walletGroups: wallet.groups }
      : {}),
    ...(snapshot.superGroups !== undefined
      ? { superGroups: superGroups.groups }
      : {}),
    totalUsd: round2(walletUsd + superUsd),
    walletUsd,
    superUsd,
  };
}

/* ── symbol + chain → assetId ────────────────────────────── */

export type RowLookup = (symbol: string) => readonly AssetLookupRow[];

export type ResolvedItemAsset = {
  assetId: string;
  /** When the catalogue observed the price, when a row names it. */
  priceAsOf?: number;
};

function findRowByAssetId(
  assetId: string,
  symbol: string,
  lookup: RowLookup,
): AssetLookupRow | undefined {
  if (!symbol) return undefined;
  const wanted = assetId.toLowerCase();
  return lookup(symbol).find((row) => row.assetId.toLowerCase() === wanted);
}

function contractMatches(row: AssetLookupRow, contract: string): boolean {
  const assetId = row.assetId.toLowerCase();
  const rowContract = (row.contractAddress ?? "").toLowerCase();
  return (
    rowContract === contract ||
    assetId === contract ||
    assetId === `nep141:${contract}` ||
    assetId.endsWith(`-${contract}`) ||
    assetId.endsWith(`:${contract}`)
  );
}

/**
 * Resolves one balance row to the catalogue's assetId and observation time.
 *
 * An explicit assetId is the strongest answer. A contract-bearing row must
 * match a catalogue contract, preferring the row's own chain; it never
 * falls back to the ticker or to another chain, because a fake token with a
 * real ticker is a different asset. Only a contract-less native row may use
 * symbol plus chain. A chain-specific row never borrows another chain's
 * price: a missing match leaves the stored value alone.
 */
export function resolveItemAsset(
  item: AssetItem,
  lookup: RowLookup,
): ResolvedItemAsset | undefined {
  const symbol = item.symbol?.trim().toUpperCase() ?? "";
  const explicit = (item as LiveAssetItem).assetId;
  if (typeof explicit === "string" && explicit.length > 0) {
    const row = findRowByAssetId(explicit, symbol, lookup);
    return {
      assetId: explicit,
      ...(row?.priceAsOf !== undefined ? { priceAsOf: row.priceAsOf } : {}),
    };
  }

  const contract = item.contractAddress?.trim() ?? "";
  if (contract && looksLikeAssetId(contract)) {
    const row = findRowByAssetId(contract, symbol, lookup);
    return {
      assetId: contract,
      ...(row?.priceAsOf !== undefined ? { priceAsOf: row.priceAsOf } : {}),
    };
  }

  if (!symbol) return undefined;

  const rows = lookup(symbol);
  if (rows.length === 0) return undefined;

  // `evm` is a family, not a chain. The network is the useful hint there.
  const chainHint =
    item.chain && item.chain.toLowerCase() !== "evm"
      ? item.chain
      : item.network;
  const chains = chainCandidates(chainHint).filter((chain) => chain !== "evm");
  const chainKnown = chains.length > 0;

  if (contract) {
    const contractLower = contract.toLowerCase();

    if (chainKnown) {
      const byContractChain = rows.find(
        (row) =>
          contractMatches(row, contractLower) &&
          chains.includes(row.chain.trim().toLowerCase()),
      );
      if (byContractChain) {
        return {
          assetId: byContractChain.assetId,
          priceAsOf: byContractChain.priceAsOf,
        };
      }
      // The chain is known and no catalogue contract matches it. Do not
      // borrow a same-ticker row or another chain's contract.
      return undefined;
    }

    // No chain to disambiguate: a bare contract match is safe only when it
    // points at exactly one catalogue asset.
    const matches = rows.filter((row) => contractMatches(row, contractLower));
    const unique = new Map(matches.map((row) => [row.assetId, row]));
    if (unique.size !== 1) return undefined;
    const only = matches[0];
    return { assetId: only.assetId, priceAsOf: only.priceAsOf };
  }

  // A contract-less row is a native token; symbol plus chain is its identity.
  if (chainKnown) {
    const byChain = rows.find((row) =>
      chains.includes(row.chain.trim().toLowerCase()),
    );
    return byChain
      ? { assetId: byChain.assetId, priceAsOf: byChain.priceAsOf }
      : undefined;
  }

  const unique = new Map(rows.map((row) => [row.assetId, row]));
  if (unique.size !== 1) return undefined;
  const only = rows[0];
  return { assetId: only.assetId, priceAsOf: only.priceAsOf };
}

export function resolveItemAssetId(
  item: AssetItem,
  lookup: RowLookup,
): string | undefined {
  return resolveItemAsset(item, lookup)?.assetId;
}

/**
 * The symbols a snapshot still needs a catalogue row for.
 *
 * An explicit `assetId` is the whole identity. A missing `priceAsOf` only
 * affects the seed's timestamp, not which asset the row is, so it must not
 * trigger a metadata request per portfolio load.
 */
export function unresolvedSymbols(items: readonly AssetItem[]): string[] {
  const symbols = new Set<string>();
  for (const item of items) {
    if (item.assetId?.trim()) continue;
    const symbol = item.symbol?.trim().toUpperCase();
    if (symbol) symbols.add(symbol);
  }
  return [...symbols].sort();
}

/* ── seed quotes from a settled snapshot ─────────────────── */

export type SnapshotSeed = {
  assetId: string;
  usd: number;
  /** The row's own observation time, or the catalogue's. */
  asOf?: number;
};

/**
 * The stored unit prices a snapshot can seed the live store with.
 *
 * Only rows with a usable unit price are seeded; a row without one has
 * nothing honest to paint before the socket answers. The row's own
 * `priceAsOf` is preferred, because that is the exact observation the
 * displayed value came from; the catalogue row is the fallback.
 */
export function snapshotSeeds(
  items: readonly AssetItem[],
  resolved: ReadonlyMap<string, ResolvedItemAsset>,
): SnapshotSeed[] {
  const seeds: SnapshotSeed[] = [];
  for (const item of items) {
    const asset = resolved.get(item.id);
    // Only a row with a resolved catalogue asset can seed a quote. A fake
    // contract token with a real ticker has no assetId and must stay out of
    // the store, or it would paint itself at the real asset's price.
    if (!asset?.assetId) continue;
    if (
      typeof item.priceUsd !== "number" ||
      !Number.isFinite(item.priceUsd) ||
      item.priceUsd <= 0
    ) {
      continue;
    }
    seeds.push({
      assetId: asset.assetId,
      usd: item.priceUsd,
      ...(item.priceAsOf !== undefined || asset.priceAsOf !== undefined
        ? { asOf: item.priceAsOf ?? asset.priceAsOf }
        : {}),
    });
  }
  return seeds;
}

/* ── catalogue rows for a whole portfolio ────────────────── */

const SYMBOL_CHUNK = 20;
const ROW_TTL_MS = 5 * 60_000;
const EMPTY_ROW_TTL_MS = 30_000;

type RowCacheEntry = { rows: AssetLookupRow[]; at: number };

const rowCache = new Map<string, RowCacheEntry>();
const rowInflight = new Map<string, Promise<void>>();
const symbolInflight = new Map<string, Promise<void>>();

function rowTtl(entry: RowCacheEntry): number {
  return entry.rows.length === 0 ? EMPTY_ROW_TTL_MS : ROW_TTL_MS;
}

function rowsFor(symbol: string): readonly AssetLookupRow[] {
  return rowCache.get(symbol)?.rows ?? [];
}

async function fetchSymbolChunk(symbols: string[]): Promise<void> {
  const key = symbols.join(",");
  const existing = rowInflight.get(key);
  if (existing) return existing;

  const pending = (async () => {
    let assets: AssetLookupRow[] = [];
    try {
      const res = await fetch(
        `/api/assets?symbols=${symbols.map(encodeURIComponent).join(",")}`,
      );
      if (res.ok) {
        const body = (await res.json()) as { assets?: AssetLookupRow[] } | null;
        if (Array.isArray(body?.assets)) assets = body.assets;
      }
    } catch {
      assets = [];
    }

    const bySymbol = new Map<string, AssetLookupRow[]>();
    for (const asset of assets) {
      if (!asset || typeof asset.assetId !== "string") continue;
      if (typeof asset.symbol !== "string") continue;
      const symbol = asset.symbol.trim().toUpperCase();
      if (!symbol) continue;
      const list = bySymbol.get(symbol) ?? [];
      list.push({
        ...asset,
        symbol,
        chain: typeof asset.chain === "string" ? asset.chain : "",
      });
      bySymbol.set(symbol, list);
    }

    const at = Date.now();
    for (const symbol of symbols) {
      rowCache.set(symbol, { rows: bySymbol.get(symbol) ?? [], at });
    }
  })().finally(() => {
    rowInflight.delete(key);
    for (const symbol of symbols) {
      if (symbolInflight.get(symbol) === pending) symbolInflight.delete(symbol);
    }
  });

  rowInflight.set(key, pending);
  for (const symbol of symbols) symbolInflight.set(symbol, pending);
  return pending;
}

function ensureSymbolRows(symbols: string[]): Promise<void> {
  const now = Date.now();
  const missing: string[] = [];
  const joined: Promise<void>[] = [];

  for (const symbol of symbols) {
    const inflight = symbolInflight.get(symbol);
    if (inflight) {
      joined.push(inflight);
      continue;
    }
    const entry = rowCache.get(symbol);
    if (entry && now - entry.at < rowTtl(entry)) continue;
    missing.push(symbol);
  }

  if (missing.length === 0) return Promise.all(joined).then(() => undefined);

  const chunks: string[][] = [];
  for (let i = 0; i < missing.length; i += SYMBOL_CHUNK) {
    chunks.push(missing.slice(i, i + SYMBOL_CHUNK));
  }
  return Promise.all([...joined, ...chunks.map(fetchSymbolChunk)]).then(
    () => undefined,
  );
}

const EMPTY_IDS: string[] = [];
const EMPTY_RESOLVED: Map<string, ResolvedItemAsset> = new Map();

/**
 * The portfolio's live view.
 *
 * Every row's ticker is resolved to an assetId, the unique ids are
 * subscribed once, and the quotes are overlaid on the snapshot. The
 * snapshot's own unit prices seed the store so the first paint has a
 * figure even before the socket opens.
 *
 * With the rollout flag off the settled snapshot is returned untouched, and
 * the catalogue lookup is skipped too: the portfolio keeps the server's
 * stored prices and performs no price request.
 */
export function useLiveSnapshot(
  snapshot: PortfolioSnapshot | null,
): PortfolioSnapshot | null {
  const enabled = isPricesLive();

  const items = useMemo(() => {
    if (!snapshot) return [];
    const seen = new Set<string>();
    const out: AssetItem[] = [];
    const add = (groups: readonly AssetGroup[]) => {
      for (const group of groups) {
        for (const item of group.items) {
          if (seen.has(item.id)) continue;
          seen.add(item.id);
          out.push(item);
        }
      }
    };
    add(snapshot.groups);
    if (snapshot.walletGroups) add(snapshot.walletGroups);
    if (snapshot.superGroups) add(snapshot.superGroups);
    return out;
  }, [snapshot]);

  const direct = useMemo(() => {
    const map = new Map<string, ResolvedItemAsset>();
    for (const item of items) {
      const assetId = item.assetId?.trim();
      if (!assetId) continue;
      map.set(item.id, {
        assetId,
        ...(item.priceAsOf !== undefined ? { priceAsOf: item.priceAsOf } : {}),
      });
    }
    return map;
  }, [items]);

  const symbolsKey = useMemo(() => {
    // Only rows without an assetId need the catalogue. A fully enriched
    // snapshot performs no metadata requests and never waits on an outage.
    if (!enabled) return "";
    return unresolvedSymbols(items).join(",");
  }, [items, enabled]);

  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!enabled || !symbolsKey) return;
    let cancelled = false;
    void ensureSymbolRows(symbolsKey.split(",")).then(() => {
      if (!cancelled) setVersion((value) => value + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [symbolsKey, enabled]);

  const resolved = useMemo(() => {
    if (!enabled) return EMPTY_RESOLVED;
    const map = new Map(direct);
    for (const item of items) {
      if (map.has(item.id)) continue;
      const asset = resolveItemAsset(item, rowsFor);
      if (asset) map.set(item.id, asset);
    }
    return map;
    // `version` re-reads the row cache when a metadata request lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, direct, symbolsKey, version, enabled]);

  const ids = useMemo(
    () =>
      enabled
        ? [...new Set([...resolved.values()].map((asset) => asset.assetId))].sort()
        : EMPTY_IDS,
    [resolved, enabled],
  );

  usePriceSubscription(ids);
  const quotes = usePriceMap(ids);

  const live = useMemo(
    () =>
      enabled && snapshot
        ? applyLivePrices(
            snapshot,
            quotes,
            (item) => resolved.get(item.id)?.assetId,
          )
        : snapshot,
    [enabled, snapshot, quotes, resolved],
  );

  useEffect(() => {
    if (!enabled || !snapshot || resolved.size === 0) return;
    const seeds = snapshotSeeds(items, resolved);
    if (seeds.length > 0) seedQuotes(seeds);
  }, [enabled, snapshot, items, resolved]);

  return live;
}

/** Clears the catalogue row cache. Never call this in the app. */
export function __resetLiveSnapshotForTests(): void {
  rowCache.clear();
  rowInflight.clear();
  symbolInflight.clear();
}
