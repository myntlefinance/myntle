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
 */

const cache = new Map<string, AssetMeta | null>();

export function useResolvedAssetMeta(ids: string[]): Map<string, AssetMeta> {
  const key = useMemo(
    () => [...new Set(ids.filter((id) => id.length > 0))].sort().join(","),
    [ids],
  );
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (key.length === 0) return;
    const missing = key.split(",").filter((id) => !cache.has(id));
    if (missing.length === 0) return;
    let cancelled = false;
    void fetch(`/api/assets?ids=${missing.map(encodeURIComponent).join(",")}`)
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (body: {
          assets?: Array<{
            assetId: string;
            symbol: string;
            chain: string;
            priceUsd: number;
          }>;
        } | null,
      ) => {
        if (cancelled) return;
        const found = new Set<string>();
        for (const a of body?.assets ?? []) {
          if (typeof a?.assetId !== "string") continue;
          found.add(a.assetId);
          cache.set(a.assetId, {
            symbol: a.symbol,
            chain: a.chain,
            priceUsd: typeof a.priceUsd === "number" ? a.priceUsd : undefined,
          });
        }
        for (const id of missing) {
          if (!found.has(id)) cache.set(id, null);
        }
        setVersion((v) => v + 1);
      })
      .catch(() => {
        // Resolution is enhancement-only; fallbacks stay readable.
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return useMemo(() => {
    const out = new Map<string, AssetMeta>();
    if (key.length === 0) return out;
    for (const id of key.split(",")) {
      const hit = cache.get(id);
      if (hit) out.set(id, hit);
    }
    return out;
    // `version` is the cache-invalidation counter. The map is mutable, so the
    // rule cannot see that the memo has to recompute when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version]);
}
