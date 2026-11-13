import type { AlchemySource } from "./alchemy";
import type { BinanceSource } from "./binance";
import type { CoingeckoSource } from "./coingecko";
import type { OneclickSource } from "./oneclick";
import {
  fail,
  type CurrentQuote,
  type LiveSourceName,
  type PriceSeries,
  type SourceAttempt,
  type SourceConfig,
  type SourceFailure,
  type SourceName,
  type SourceResult,
} from "./types";

/**
 * The part of a registry row the resolver needs. The registry's full
 * `RegistryAsset` is assignable to this, so Step 04 passes the row straight
 * through without a mapping layer.
 */
export type ResolverAsset = {
  assetId: string;
  symbol: string;
  /** The fallback plan, in order, copied from the registry row. */
  sources: SourceName[];
  binanceSymbol: string | null;
  alchemySymbol: string | null;
  coingeckoId: string | null;
};

/** The adapter instances shared by every resolver call. */
export type SourceAdapters = {
  binance: BinanceSource;
  alchemy: AlchemySource;
  oneclick: OneclickSource;
  coingecko: CoingeckoSource;
};

/** One adapter call made by a batch, with the assets it covered. */
export type BatchAttempt = {
  source: LiveSourceName;
  assets: number;
  ok: boolean;
  error?: string;
  status?: number;
  retryAfterMs?: number;
};

export type BatchFailure = {
  error: string;
  attempts: SourceAttempt[];
};

export type BatchResult = {
  quotes: Map<string, CurrentQuote>;
  failures: Map<string, BatchFailure>;
  /** One entry per upstream call, not per asset. */
  attempts: BatchAttempt[];
};

/**
 * The one shape the Durable Object talks to. `current` walks one asset's
 * source order; `currentBatch` does the same for a whole refresh while calling
 * each adapter at most once per round. `series` follows the fixed history
 * order: Binance.US, Alchemy, CoinGecko. No value is ever blended from two
 * sources; the source label says exactly which one answered.
 */
export type PriceResolver = {
  current(asset: ResolverAsset): Promise<SourceResult<CurrentQuote>>;
  currentBatch(assets: ResolverAsset[]): Promise<BatchResult>;
  series(asset: ResolverAsset): Promise<SourceResult<PriceSeries>>;
};

type GroupEntry =
  | { asset: ResolverAsset; ok: true; quote: CurrentQuote }
  | { asset: ResolverAsset; ok: false; attempt: SourceAttempt };

type GroupOutcome = {
  attempt: BatchAttempt | null;
  entries: GroupEntry[];
};

function idOf(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? null : trimmed;
}

function sourceAttempt(
  source: SourceName,
  result: SourceFailure,
): SourceAttempt {
  const attempt: SourceAttempt = { source, error: result.error };
  if (result.status !== undefined) attempt.status = result.status;
  if (result.retryAfterMs !== undefined) {
    attempt.retryAfterMs = result.retryAfterMs;
  }
  return attempt;
}

function failedGroup(
  assets: ResolverAsset[],
  source: SourceName,
  result: SourceFailure,
): GroupEntry[] {
  const attempt = sourceAttempt(source, result);
  return assets.map((asset) => ({ asset, ok: false, attempt }));
}

function skippedGroup(
  assets: ResolverAsset[],
  source: SourceName,
  error: string,
): GroupEntry[] {
  return assets.map((asset) => ({
    asset,
    ok: false,
    attempt: { source, error },
  }));
}

function quoteEntry(asset: ResolverAsset, quote: CurrentQuote): GroupEntry {
  return { asset, ok: true, quote: { ...quote, assetId: asset.assetId } };
}

function batchFailure(
  source: LiveSourceName,
  assets: number,
  result: SourceFailure,
): BatchAttempt {
  const attempt: BatchAttempt = {
    source,
    assets,
    ok: false,
    error: result.error,
  };
  if (result.status !== undefined) attempt.status = result.status;
  if (result.retryAfterMs !== undefined) {
    attempt.retryAfterMs = result.retryAfterMs;
  }
  return attempt;
}

function groupBy(
  assets: ResolverAsset[],
  keyOf: (asset: ResolverAsset) => string | null,
): { groups: Map<string, ResolverAsset[]>; skipped: ResolverAsset[] } {
  const groups = new Map<string, ResolverAsset[]>();
  const skipped: ResolverAsset[] = [];

  for (const asset of assets) {
    const key = keyOf(asset);
    if (key === null) {
      skipped.push(asset);
      continue;
    }
    const group = groups.get(key) ?? [];
    group.push(asset);
    groups.set(key, group);
  }

  return { groups, skipped };
}

/** The last reason is the top-level failure; every reason stays in attempts. */
function exhausted(
  attempts: SourceAttempt[],
  fallback: string,
): SourceFailure {
  const last = attempts.at(-1);
  const result = fail(last?.error ?? fallback, {
    status: last?.status,
    retryAfterMs: last?.retryAfterMs,
  });
  if (attempts.length > 0) result.attempts = attempts;
  return result;
}

/** History being unavailable is a normal state, not the last source's error. */
function noHistory(attempts: SourceAttempt[]): SourceFailure {
  const last = attempts.at(-1);
  const result = fail("no-history", {
    status: last?.status,
    retryAfterMs: last?.retryAfterMs,
  });
  if (attempts.length > 0) result.attempts = attempts;
  return result;
}

export function createPriceResolver(
  sources: SourceAdapters,
  config: SourceConfig = {},
): PriceResolver {
  const { binance, alchemy, oneclick, coingecko } = sources;
  // `config` is accepted for the Step 04 call site, which has one object for
  // every source. The adapters already hold the keys and the clock; the
  // resolver itself is pure dispatch and reads nothing from it today.
  void config;

  async function binanceGroup(
    assets: ResolverAsset[],
  ): Promise<GroupOutcome> {
    const { groups, skipped } = groupBy(assets, (asset) => {
      const pair = idOf(asset.binanceSymbol);
      return pair === null ? null : pair.toUpperCase();
    });
    const entries = skippedGroup(skipped, "binance", "no-symbol");

    if (groups.size === 0) return { attempt: null, entries };

    const covered = [...groups.values()].reduce(
      (count, group) => count + group.length,
      0,
    );
    const result = await binance.fetchCurrent([...groups.keys()]);

    if (!result.ok) {
      return {
        attempt: batchFailure("binance", covered, result),
        entries: [
          ...entries,
          ...failedGroup(
            [...groups.values()].flat(),
            "binance",
            result,
          ),
        ],
      };
    }

    const prices = new Map(
      result.value.map((quote) => [quote.symbol.toUpperCase(), quote]),
    );
    for (const [pair, group] of groups) {
      const quote = prices.get(pair);
      for (const asset of group) {
        entries.push(
          quote === undefined
            ? {
                asset,
                ok: false,
                attempt: { source: "binance", error: "no-quote" },
              }
            : quoteEntry(asset, quote),
        );
      }
    }

    return {
      attempt: { source: "binance", assets: covered, ok: true },
      entries,
    };
  }

  async function alchemyGroup(
    assets: ResolverAsset[],
  ): Promise<GroupOutcome> {
    if (!alchemy.configured) {
      return {
        attempt: null,
        entries: skippedGroup(assets, "alchemy", "not-configured"),
      };
    }

    const { groups, skipped } = groupBy(assets, (asset) => {
      const symbol = idOf(asset.alchemySymbol);
      return symbol === null ? null : symbol.toUpperCase();
    });
    const entries = skippedGroup(skipped, "alchemy", "no-symbol");

    if (groups.size === 0) return { attempt: null, entries };

    const covered = [...groups.values()].reduce(
      (count, group) => count + group.length,
      0,
    );
    const result = await alchemy.fetchCurrent([...groups.keys()]);

    if (!result.ok) {
      return {
        attempt: batchFailure("alchemy", covered, result),
        entries: [
          ...entries,
          ...failedGroup(
            [...groups.values()].flat(),
            "alchemy",
            result,
          ),
        ],
      };
    }

    const prices = new Map(
      result.value.map((quote) => [quote.symbol.toUpperCase(), quote]),
    );
    for (const [symbol, group] of groups) {
      const quote = prices.get(symbol);
      for (const asset of group) {
        entries.push(
          quote === undefined
            ? {
                asset,
                ok: false,
                attempt: { source: "alchemy", error: "no-quote" },
              }
            : quoteEntry(asset, quote),
        );
      }
    }

    return {
      attempt: { source: "alchemy", assets: covered, ok: true },
      entries,
    };
  }

  async function oneclickGroup(
    assets: ResolverAsset[],
  ): Promise<GroupOutcome> {
    if (assets.length === 0) return { attempt: null, entries: [] };

    // The adapter caches the catalogue for 60 seconds, so a second round or
    // the next alarm tick reuses the same rows instead of refetching.
    const result = await oneclick.fetchCurrent();

    if (!result.ok) {
      return {
        attempt: batchFailure("oneclick", assets.length, result),
        entries: failedGroup(assets, "oneclick", result),
      };
    }

    const prices = new Map(
      result.value.map((quote) => [quote.assetId, quote]),
    );
    const entries: GroupEntry[] = assets.map((asset) => {
      const quote = prices.get(asset.assetId);
      return quote === undefined
        ? {
            asset,
            ok: false,
            attempt: { source: "oneclick", error: "no-quote" },
          }
        : quoteEntry(asset, quote);
    });

    return {
      attempt: { source: "oneclick", assets: assets.length, ok: true },
      entries,
    };
  }

  function currentGroup(
    source: LiveSourceName,
    assets: ResolverAsset[],
  ): Promise<GroupOutcome> {
    if (source === "binance") return binanceGroup(assets);
    if (source === "alchemy") return alchemyGroup(assets);
    return oneclickGroup(assets);
  }

  async function currentBatch(
    input: ResolverAsset[],
  ): Promise<BatchResult> {
    const quotes = new Map<string, CurrentQuote>();
    const failures = new Map<string, BatchFailure>();
    const attempts: BatchAttempt[] = [];

    // One row per asset, so a duplicate input cannot be fetched or stored twice.
    const pending = new Map<string, ResolverAsset>();
    for (const asset of input) pending.set(asset.assetId, asset);

    const trails = new Map<string, SourceAttempt[]>();
    const cursor = new Map<string, number>();
    for (const assetId of pending.keys()) {
      trails.set(assetId, []);
      cursor.set(assetId, 0);
    }

    while (pending.size > 0) {
      const groups = new Map<LiveSourceName, ResolverAsset[]>();
      const exhausted: string[] = [];

      // One round consumes one live source slot per pending asset. CoinGecko
      // has no current price, so it is skipped without a call.
      for (const [assetId, asset] of pending) {
        let index = cursor.get(assetId) ?? 0;
        while (
          index < asset.sources.length &&
          asset.sources[index] === "coingecko"
        ) {
          index += 1;
        }

        if (index >= asset.sources.length) {
          exhausted.push(assetId);
          continue;
        }

        cursor.set(assetId, index + 1);
        const source = asset.sources[index] as LiveSourceName;
        const group = groups.get(source) ?? [];
        group.push(asset);
        groups.set(source, group);
      }

      for (const assetId of exhausted) {
        pending.delete(assetId);
        const trail = trails.get(assetId) ?? [];
        failures.set(assetId, {
          error: trail.at(-1)?.error ?? "no-source",
          attempts: trail,
        });
      }

      if (groups.size === 0) break;

      // One adapter call per source in this round, never one per asset.
      const outcomes = await Promise.all(
        [...groups].map(async ([source, group]) => ({
          outcome: await currentGroup(source, group),
        })),
      );

      for (const { outcome } of outcomes) {
        if (outcome.attempt !== null) attempts.push(outcome.attempt);

        for (const entry of outcome.entries) {
          const assetId = entry.asset.assetId;
          if (entry.ok) {
            pending.delete(assetId);
            quotes.set(assetId, entry.quote);
          } else {
            trails.get(assetId)?.push(entry.attempt);
          }
        }
      }
    }

    return { quotes, failures, attempts };
  }

  async function seriesFrom(
    source: "binance" | "alchemy" | "coingecko",
    asset: ResolverAsset,
  ): Promise<{ ok: true; value: PriceSeries } | { ok: false; attempt: SourceAttempt }> {
    if (source === "binance") {
      const pair = idOf(asset.binanceSymbol);
      if (pair === null) {
        return { ok: false, attempt: { source, error: "no-symbol" } };
      }
      const result = await binance.fetchSeries(pair);
      return result.ok
        ? { ok: true, value: result.value }
        : { ok: false, attempt: sourceAttempt(source, result) };
    }

    if (source === "alchemy") {
      if (!alchemy.configured) {
        return { ok: false, attempt: { source, error: "not-configured" } };
      }
      const symbol = idOf(asset.alchemySymbol);
      if (symbol === null) {
        return { ok: false, attempt: { source, error: "no-symbol" } };
      }
      const result = await alchemy.fetchSeries(symbol);
      return result.ok
        ? { ok: true, value: result.value }
        : { ok: false, attempt: sourceAttempt(source, result) };
    }

    const id = idOf(asset.coingeckoId);
    if (id === null) {
      return { ok: false, attempt: { source, error: "no-symbol" } };
    }
    const result = await coingecko.fetchSeries(id);
    return result.ok
      ? { ok: true, value: result.value }
      : { ok: false, attempt: sourceAttempt(source, result) };
  }

  return {
    async current(asset: ResolverAsset): Promise<SourceResult<CurrentQuote>> {
      const batch = await currentBatch([asset]);

      const quote = batch.quotes.get(asset.assetId);
      if (quote !== undefined) return { ok: true, value: quote };

      const failure = batch.failures.get(asset.assetId);
      if (failure === undefined) return fail("no-source");
      return exhausted(failure.attempts, failure.error);
    },

    currentBatch,

    /**
     * The fixed history order from the plan. OneClick has no series, and a
     * source with no mapping for this asset is skipped without a call.
     */
    async series(asset: ResolverAsset): Promise<SourceResult<PriceSeries>> {
      const attempts: SourceAttempt[] = [];

      for (const source of [
        "binance",
        "alchemy",
        "coingecko",
      ] as const) {
        const outcome = await seriesFrom(source, asset);
        if (outcome.ok) return outcome;
        attempts.push(outcome.attempt);
      }

      return noHistory(attempts);
    },
  };
}
