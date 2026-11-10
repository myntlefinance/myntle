"use client";

import { useEffect, useMemo, useState } from "react";
import type { AssetMeta } from "./toolParts";

/**
 * Fills asset metadata the turn never looked up.
 *
 * A quote-only turn carries no catalogue output, so tickers, chains, and
 * prices would fall back to raw contract ids. Missing ids resolve through
 * /api/assets once and are cached process-wide; unknown ids resolve to
 * null so they are never requested twice.
 *
 * The cache also survives a same-tab reload. The whole thread used to wait
 * for /api/assets even when the messages were already in sessionStorage,
 * because this map was memory-only. A reload now paints the tickers it
 * already knows instead of holding the whole transcript.
 */

const STORAGE_KEY = "myntle-asset-meta-v1";
const MAX_ENTRIES = 500;

const cache = new Map<string, AssetMeta | null>();
let hydrated = false;

function storage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      return window.sessionStorage;
    }
    const global = globalThis as { sessionStorage?: Storage };
    return global.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  const store = storage();
  if (!store) return;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, AssetMeta>;
    for (const [id, value] of Object.entries(parsed).slice(-MAX_ENTRIES)) {
      if (!value || typeof value !== "object") continue;
      if (typeof value.symbol !== "string" || value.symbol.length === 0) {
        continue;
      }
      cache.set(id, {
        symbol: value.symbol.toUpperCase(),
        chain: typeof value.chain === "string" ? value.chain : undefined,
        priceUsd:
          typeof value.priceUsd === "number" ? value.priceUsd : undefined,
        decimals:
          typeof value.decimals === "number" &&
          Number.isInteger(value.decimals)
            ? value.decimals
            : undefined,
      });
    }
  } catch {
    // Corrupt storage never breaks a card; memory still works.
  }
}

function persist(): void {
  const store = storage();
  if (!store) return;
  try {
    const entries: Record<string, AssetMeta> = {};
    for (const [id, meta] of [...cache.entries()].slice(-MAX_ENTRIES)) {
      if (!meta) continue;
      entries[id] = {
        symbol: meta.symbol,
        chain: meta.chain,
        priceUsd: meta.priceUsd,
        decimals: meta.decimals,
      };
    }
    store.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Quota or private mode: memory still covers this session.
  }
}

hydrate();

/**
 * The resolved map plus whether any requested id is still unresolved.
 *
 * `known` is metadata the caller already has from the turn itself. A quote
 * usually carries the catalogue rows, and asking /api/assets for an id the
 * message already names is what kept the thread skeleton up on every reload.
 *
 * `pending` is what lets a caller hold its first paint: a card that renders
 * before this is false would show `nep141:172086…a33a1` and then swap to
 * `USDC`, which reads as the wrong asset rather than as loading.
 */
export function useAssetMetaResolution(
  ids: string[],
  known?: ReadonlyMap<string, AssetMeta>,
): {
  meta: Map<string, AssetMeta>;
  pending: boolean;
} {
  const key = useMemo(
    () => [...new Set(ids.filter((id) => id.length > 0))].sort().join(","),
    [ids],
  );
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (key.length === 0) return;
    const missing = key
      .split(",")
      .filter((id) => !known?.has(id) && !cache.has(id));
    if (missing.length === 0) return;
    let cancelled = false;
    // The route resolves at most twenty ids per request, and a long thread
    // can name more than that. Asking in batches keeps every card resolvable
    // instead of silently marking the overflow unknown.
    const chunks: string[][] = [];
    for (let i = 0; i < missing.length; i += 20) {
      chunks.push(missing.slice(i, i + 20));
    }
    void Promise.all(
      chunks.map((chunk) =>
        fetch(`/api/assets?ids=${chunk.map(encodeURIComponent).join(",")}`)
          .then((res) => (res.ok ? res.json() : null))
          .then(
            (
              body: {
                assets?: Array<{
                  assetId: string;
                  symbol: string;
                  chain: string;
                  decimals?: number;
                  priceUsd: number;
                }>;
              } | null,
            ) => ({ chunk, body }),
          )
          .catch(() => ({ chunk, body: null })),
      ),
    ).then((results) => {
      if (cancelled) return;
      for (const { chunk, body } of results) {
        const found = new Set<string>();
        for (const a of body?.assets ?? []) {
          if (typeof a?.assetId !== "string") continue;
          found.add(a.assetId);
          cache.set(a.assetId, {
            symbol: a.symbol,
            chain: a.chain,
            priceUsd: typeof a.priceUsd === "number" ? a.priceUsd : undefined,
            decimals:
              typeof a.decimals === "number" && Number.isInteger(a.decimals)
                ? a.decimals
                : undefined,
          });
        }
        // A failed or empty answer is an answer: the card falls back to the
        // short id rather than waiting on a promise that will never settle.
        for (const id of chunk) {
          if (!found.has(id) && !cache.has(id)) cache.set(id, null);
        }
      }
      persist();
      setVersion((v) => v + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [key, known]);

  const meta = useMemo(() => {
    const out = new Map<string, AssetMeta>();
    if (key.length === 0) return out;
    for (const id of key.split(",")) {
      const fromTurn = known?.get(id);
      if (fromTurn) {
        out.set(id, fromTurn);
        continue;
      }
      const hit = cache.get(id);
      if (hit) out.set(id, hit);
    }
    return out;
    // `version` is the cache-invalidation counter. The map is mutable, so the
    // rule cannot see that the memo has to recompute when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, known, version]);

  const pending = useMemo(() => {
    if (key.length === 0) return false;
    return key
      .split(",")
      .some((id) => !known?.has(id) && !cache.has(id));
    // `version` re-reads the cache when a resolve lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, known, version]);

  return { meta, pending };
}

export function useResolvedAssetMeta(
  ids: string[],
  known?: ReadonlyMap<string, AssetMeta>,
): Map<string, AssetMeta> {
  return useAssetMetaResolution(ids, known).meta;
}
