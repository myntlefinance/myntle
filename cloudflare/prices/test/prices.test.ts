import { describe, expect, it } from "vitest";
import {
  ACTIVE_INTERVAL_MS,
  catalogueDue,
  decodeSnapshot,
  deriveSources,
  emptySnapshot,
  encodeSnapshot,
  HOT_INTERVAL_MS,
  HOT_SYMBOLS,
  hotQuerySymbols,
  intervalMs,
  isFresh,
  isStale,
  liveQuotes,
  mergeQuotes,
  needsRefresh,
  pickHotAssetIds,
  presentPrices,
  presentQuote,
  pruneRecent,
  RECENT_MAX,
  RECENT_TTL_MS,
  scheduledAlarmAt,
  trackRecent,
  ttlForSource,
  watchedAssets,
  type Quote,
} from "../src/prices";

const NOW = 1_762_000_000_000;

describe("freshness", () => {
  it("uses the plan's per-source TTLs", () => {
    expect(ttlForSource("binance")).toBe(10_000);
    expect(ttlForSource("alchemy")).toBe(60_000);
    expect(ttlForSource("oneclick")).toBe(60_000);
  });

  it("refreshes past one TTL and marks stale past two", () => {
    const quote: Quote = { usd: 3.6, asOf: NOW, source: "binance" };

    expect(isFresh(quote, NOW + 10_000)).toBe(true);
    expect(isFresh(quote, NOW + 10_001)).toBe(false);

    expect(isStale(quote, NOW + 20_000)).toBe(false);
    expect(isStale(quote, NOW + 20_001)).toBe(true);
  });

  it("applies the 2x threshold to the slower sources", () => {
    const alchemy: Quote = { usd: 1, asOf: NOW, source: "alchemy" };
    const oneclick: Quote = { usd: 1, asOf: NOW, source: "oneclick" };

    expect(isStale(alchemy, NOW + 120_000)).toBe(false);
    expect(isStale(alchemy, NOW + 120_001)).toBe(true);
    expect(isStale(oneclick, NOW + 120_000)).toBe(false);
    expect(isStale(oneclick, NOW + 120_001)).toBe(true);
  });

  it("never treats a future timestamp as stale", () => {
    const quote: Quote = { usd: 1, asOf: NOW + 5_000, source: "binance" };
    expect(isStale(quote, NOW)).toBe(false);
    expect(isFresh(quote, NOW)).toBe(true);
  });

  it("always reports freshness at the boundary", () => {
    expect(presentQuote({ usd: 3.6, asOf: NOW, source: "binance" }, NOW)).toEqual(
      { usd: 3.6, asOf: NOW, source: "binance", stale: false },
    );
    expect(
      presentQuote({ usd: 3.6, asOf: NOW, source: "binance" }, NOW + 20_001),
    ).toEqual({
      usd: 3.6,
      asOf: NOW,
      source: "binance",
      stale: true,
    });
  });

  it("keeps a failure flag even while the quote is young", () => {
    expect(
      presentQuote(
        { usd: 3.6, asOf: NOW, source: "alchemy", stale: true },
        NOW + 1_000,
      ),
    ).toEqual({ usd: 3.6, asOf: NOW, source: "alchemy", stale: true });
  });
});

describe("needsRefresh", () => {
  it("refreshes a quote that has never been fetched", () => {
    expect(needsRefresh(undefined, NOW)).toBe(true);
  });

  it("refreshes a stale flag even inside the source TTL", () => {
    expect(
      needsRefresh(
        { usd: 3.6, asOf: NOW, source: "alchemy", stale: true },
        NOW + 1_000,
      ),
    ).toBe(true);
  });

  it("skips a fresh quote and refreshes one past its TTL", () => {
    const quote: Quote = { usd: 3.6, asOf: NOW, source: "binance" };

    expect(needsRefresh(quote, NOW + 5_000)).toBe(false);
    expect(needsRefresh(quote, NOW + 10_001)).toBe(true);
  });
});

describe("presentPrices", () => {
  it("returns null for a delisted id and reports it for removal", () => {
    const quotes = new Map<string, Quote>([
      ["kept", { usd: 3.6, asOf: NOW, source: "binance" }],
      ["gone", { usd: 9.9, asOf: NOW, source: "oneclick" }],
    ]);

    const view = presentPrices(
      ["kept", "gone", "missing"],
      quotes,
      new Set(["kept"]),
      NOW,
    );

    expect(view.prices.kept).toEqual({
      usd: 3.6,
      asOf: NOW,
      source: "binance",
      stale: false,
    });
    expect(view.prices.gone).toBeNull();
    expect(view.prices.missing).toBeNull();
    expect(view.removed).toEqual(["gone"]);
    expect(view.asOf).toBe(NOW);
  });

  it("uses the read time when nothing is priced", () => {
    const view = presentPrices(["missing"], new Map(), new Set(), NOW);

    expect(view.prices.missing).toBeNull();
    expect(view.removed).toEqual([]);
    expect(view.asOf).toBe(NOW);
  });
});

describe("liveQuotes", () => {
  it("drops a cached quote the registry no longer lists", () => {
    const quotes = new Map<string, Quote>([
      ["kept", { usd: 3.6, asOf: NOW, source: "binance" }],
      ["gone", { usd: 9.9, asOf: NOW, source: "oneclick" }],
    ]);

    const live = liveQuotes(quotes, new Set(["kept"]), NOW);

    expect(Object.keys(live.quotes)).toEqual(["kept"]);
    expect(live.quotes.kept.stale).toBe(false);
    expect(live.stale).toBe(0);
  });

  it("sorts the live ids and counts a stale one", () => {
    const quotes = new Map<string, Quote>([
      ["b", { usd: 2, asOf: NOW, source: "binance", stale: true }],
      ["a", { usd: 1, asOf: NOW, source: "binance" }],
    ]);

    const live = liveQuotes(quotes, new Set(["a", "b"]), NOW);

    expect(Object.keys(live.quotes)).toEqual(["a", "b"]);
    expect(live.stale).toBe(1);
  });

  it("returns nothing when no cached id is still listed", () => {
    const quotes = new Map<string, Quote>([
      ["gone", { usd: 1, asOf: NOW, source: "binance" }],
    ]);

    expect(liveQuotes(quotes, new Set(), NOW)).toEqual({
      quotes: {},
      stale: 0,
    });
  });
});

describe("mergeQuotes", () => {
  it("replaces a fresh quote, clears stale, and keeps the answering source", () => {
    const previous = new Map<string, Quote>([
      ["btc", { usd: 100, asOf: NOW - 30_000, source: "binance", stale: true }],
    ]);

    const next = mergeQuotes(previous, {
      quotes: new Map([
        ["btc", { usd: 101, asOf: NOW, source: "alchemy" as const }],
      ]),
      failures: [],
    });

    expect(next.get("btc")).toEqual({
      usd: 101,
      asOf: NOW,
      source: "alchemy",
    });
  });

  it("keeps the previous value and marks it stale on a failed refresh", () => {
    const previous = new Map<string, Quote>([
      ["eth", { usd: 50, asOf: NOW - 30_000, source: "alchemy" }],
    ]);

    const next = mergeQuotes(previous, {
      quotes: new Map(),
      failures: ["eth"],
    });

    expect(next.get("eth")).toEqual({
      usd: 50,
      asOf: NOW - 30_000,
      source: "alchemy",
      stale: true,
    });
  });

  it("drops a failed id that has no previous value", () => {
    const next = mergeQuotes(new Map(), {
      quotes: new Map(),
      failures: ["sol"],
    });

    expect(next.has("sol")).toBe(false);
  });

  it("leaves ids that nobody touched alone", () => {
    const previous = new Map<string, Quote>([
      ["btc", { usd: 100, asOf: NOW, source: "binance" }],
      ["eth", { usd: 50, asOf: NOW, source: "alchemy" }],
    ]);

    const next = mergeQuotes(previous, {
      quotes: new Map([["eth", { usd: 51, asOf: NOW + 1, source: "binance" as const }]]),
      failures: [],
    });

    expect(next.get("btc")).toEqual(previous.get("btc"));
    expect(next.get("eth")?.usd).toBe(51);
  });

  it("treats a malformed answer as a failed refresh, never a zero", () => {
    const previous = new Map<string, Quote>([
      ["btc", { usd: 100, asOf: NOW, source: "binance" }],
    ]);

    const next = mergeQuotes(previous, {
      quotes: new Map([
        ["btc", { usd: Number.NaN, asOf: NOW, source: "binance" as const }],
      ]),
      failures: [],
    });

    expect(next.get("btc")).toEqual({
      usd: 100,
      asOf: NOW,
      source: "binance",
      stale: true,
    });
  });

  it("does not mutate the map it was given", () => {
    const previous = new Map<string, Quote>([
      ["btc", { usd: 100, asOf: NOW, source: "binance" }],
    ]);

    mergeQuotes(previous, {
      quotes: new Map([["btc", { usd: 101, asOf: NOW + 1, source: "binance" as const }]]),
      failures: [],
    });

    expect(previous.get("btc")?.usd).toBe(100);
  });
});

describe("snapshot payload", () => {
  it("round-trips quotes and the last tick", () => {
    const quotes = new Map<string, Quote>([
      ["btc", { usd: 74_253, asOf: NOW, source: "binance" }],
      [
        "eth",
        { usd: 2_070.52, asOf: NOW - 1_000, source: "alchemy", stale: true },
      ],
    ]);

    const decoded = decodeSnapshot(encodeSnapshot(quotes, NOW));

    expect(decoded.version).toBe(1);
    expect(decoded.lastTickAt).toBe(NOW);
    expect(decoded.quotes).toEqual(Object.fromEntries(quotes));
  });

  it("round-trips an empty map and a null tick", () => {
    expect(decodeSnapshot(encodeSnapshot(new Map(), null))).toEqual(
      emptySnapshot(),
    );
  });

  it("starts empty for a missing, corrupt, or unknown payload", () => {
    expect(decodeSnapshot(null)).toEqual(emptySnapshot());
    expect(decodeSnapshot(undefined)).toEqual(emptySnapshot());
    expect(decodeSnapshot("")).toEqual(emptySnapshot());
    expect(decodeSnapshot("{not json")).toEqual(emptySnapshot());
    expect(decodeSnapshot("[]")).toEqual(emptySnapshot());
    expect(decodeSnapshot('{"version":1,"quotes":[]}')).toEqual(
      emptySnapshot(),
    );
    expect(decodeSnapshot('{"version":99,"quotes":{}}')).toEqual(
      emptySnapshot(),
    );
  });

  it("drops only the corrupt row, keeping the usable ones", () => {
    const payload = JSON.stringify({
      version: 1,
      lastTickAt: NOW,
      quotes: {
        good: { usd: 1, asOf: NOW, source: "binance" },
        badPrice: { usd: "1", asOf: NOW, source: "binance" },
        badSource: { usd: 1, asOf: NOW, source: "yahoo" },
        badTime: { usd: 1, asOf: 0, source: "binance" },
      },
    });

    const decoded = decodeSnapshot(payload);

    expect(Object.keys(decoded.quotes)).toEqual(["good"]);
    expect(decoded.lastTickAt).toBe(NOW);
  });
});

describe("deriveSources", () => {
  it("puts a Binance-primary row first with Alchemy and 1Click behind it", () => {
    expect(
      deriveSources({
        primarySource: "binance",
        binanceSymbol: "BTCUSDT",
        alchemySymbol: "BTC",
      }),
    ).toEqual(["binance", "alchemy", "oneclick"]);
  });

  it("puts an Alchemy-primary row first with its Binance fallback", () => {
    expect(
      deriveSources({
        primarySource: "alchemy",
        binanceSymbol: "USDTUSD",
        alchemySymbol: "USDT",
      }),
    ).toEqual(["alchemy", "binance", "oneclick"]);
  });

  it("keeps a 1Click-only row alone", () => {
    expect(
      deriveSources({
        primarySource: "oneclick",
        binanceSymbol: null,
        alchemySymbol: null,
      }),
    ).toEqual(["oneclick"]);
  });

  it("skips a missing or blank secondary mapping", () => {
    expect(
      deriveSources({
        primarySource: "binance",
        binanceSymbol: "NEARUSDT",
        alchemySymbol: null,
      }),
    ).toEqual(["binance", "oneclick"]);

    expect(
      deriveSources({
        primarySource: "alchemy",
        binanceSymbol: "   ",
        alchemySymbol: "XYZ",
      }),
    ).toEqual(["alchemy", "oneclick"]);
  });

  it("never repeats a source", () => {
    const sources = deriveSources({
      primarySource: "alchemy",
      binanceSymbol: "NEARUSDT",
      alchemySymbol: "NEAR",
    });
    expect(new Set(sources).size).toBe(sources.length);
  });
});

describe("hot set", () => {
  it("prefers the near chain, then eth, then the rest", () => {
    const rows = [
      { assetId: "usdc-bsc", symbol: "USDC", chain: "bsc" },
      { assetId: "usdc-eth", symbol: "USDC", chain: "eth" },
      { assetId: "usdc-near", symbol: "USDC", chain: "near" },
    ];

    expect(pickHotAssetIds(rows, ["USDC"])).toEqual(["usdc-near"]);
  });

  it("treats a wrapped 1:1 alias as its underlying", () => {
    const rows = [
      { assetId: "near-bsc", symbol: "NEAR", chain: "bsc" },
      { assetId: "wrap.near", symbol: "wNEAR", chain: "near" },
    ];

    expect(pickHotAssetIds(rows, ["NEAR"])).toEqual(["wrap.near"]);
  });

  it("prefers an exact ticker over an alias on the same chain", () => {
    const rows = [
      { assetId: "wbtc-near", symbol: "wBTC", chain: "near" },
      { assetId: "nbtc-near", symbol: "BTC", chain: "near" },
      { assetId: "btc-omft", symbol: "BTC", chain: "btc" },
    ];

    expect(pickHotAssetIds(rows, ["BTC"])).toEqual(["nbtc-near"]);
  });

  it("prefers the token's own chain over another non-canonical chain", () => {
    const rows = [
      { assetId: "1cs_v1:aptos:sol", symbol: "SOL", chain: "aptos" },
      { assetId: "nep141:sol.omft.near", symbol: "SOL", chain: "sol" },
    ];

    expect(pickHotAssetIds(rows, ["SOL"])).toEqual([
      "nep141:sol.omft.near",
    ]);
  });

  it("breaks a same-chain tie by assetId", () => {
    const rows = [
      { assetId: "eth-omft", symbol: "ETH", chain: "near" },
      { assetId: "eth-bridge", symbol: "ETH", chain: "near" },
    ];

    expect(pickHotAssetIds(rows, ["ETH"])).toEqual(["eth-bridge"]);
  });

  it("returns one id per ticker in the hot order, skipping absent ones", () => {
    const rows = [
      { assetId: "usdc-near", symbol: "USDC", chain: "near" },
      { assetId: "wrap.near", symbol: "wNEAR", chain: "near" },
    ];

    expect(pickHotAssetIds(rows)).toEqual(["usdc-near", "wrap.near"]);
    expect(HOT_SYMBOLS).toContain("NEAR");
  });

  it("asks for the aliases that can map onto a hot ticker", () => {
    const symbols = hotQuerySymbols(["NEAR"]);

    expect(symbols).toContain("NEAR");
    expect(symbols).toContain("WNEAR");
    expect(symbols).not.toContain("WETH");
  });
});

describe("watched set", () => {
  it("unions the hot set with fresh recent ids", () => {
    const recent = new Map([
      ["requested", NOW - 1_000],
      ["expired", NOW - RECENT_TTL_MS],
    ]);

    expect(
      watchedAssets({ hot: ["hot"], recent, now: NOW }),
    ).toEqual(["hot", "requested"]);
  });

  it("prunes an id at exactly the TTL boundary", () => {
    const recent = new Map([
      ["kept", NOW - RECENT_TTL_MS + 1],
      ["dropped", NOW - RECENT_TTL_MS],
    ]);

    expect([...pruneRecent(recent, NOW).keys()]).toEqual(["kept"]);
  });

  it("sorts ids so the log line and payload do not churn", () => {
    expect(
      watchedAssets({
        hot: ["c", "a"],
        recent: new Map([["b", NOW]]),
        now: NOW,
      }),
    ).toEqual(["a", "b", "c"]);
  });

  it("schedules 10s while recent is active and 30s for hot only", () => {
    expect(intervalMs(true)).toBe(ACTIVE_INTERVAL_MS);
    expect(intervalMs(false)).toBe(HOT_INTERVAL_MS);
  });
});

describe("scheduledAlarmAt", () => {
  it("prefers the scheduled alarm", () => {
    expect(
      scheduledAlarmAt({
        alarmAt: NOW + 5_000,
        lastTickAt: NOW,
        intervalMs: 10_000,
        now: NOW,
      }),
    ).toBe(NOW + 5_000);
  });

  it("falls back to the last tick plus the interval during a tick", () => {
    expect(
      scheduledAlarmAt({
        alarmAt: null,
        lastTickAt: NOW,
        intervalMs: 10_000,
        now: NOW + 500,
      }),
    ).toBe(NOW + 10_000);
  });

  it("falls back to now plus the interval before the first tick", () => {
    expect(
      scheduledAlarmAt({
        alarmAt: null,
        lastTickAt: null,
        intervalMs: 30_000,
        now: NOW,
      }),
    ).toBe(NOW + 30_000);
  });
});

describe("recent demand set", () => {
  it("records only ids the registry knows", () => {
    const recent = new Map<string, number>([["known", NOW - 30_000]]);

    const next = trackRecent(
      recent,
      ["known", "unknown"],
      new Set(["known"]),
      NOW,
    );

    expect(next.get("known")).toBe(NOW);
    expect(next.has("unknown")).toBe(false);
  });

  it("prunes an expired id while renewing a requested one", () => {
    const recent = new Map<string, number>([
      ["old", NOW - RECENT_TTL_MS],
      ["requested", NOW - 1_000],
    ]);

    const next = trackRecent(recent, ["requested"], new Set(["requested"]), NOW);

    expect([...next.keys()]).toEqual(["requested"]);
    expect(next.get("requested")).toBe(NOW);
  });

  it("caps the map and keeps the newest entries", () => {
    const recent = new Map<string, number>([
      ["old", NOW - 3_000],
      ["mid", NOW - 2_000],
      ["new", NOW - 1_000],
    ]);

    const next = pruneRecent(recent, NOW, 2);

    expect([...next.keys()].sort()).toEqual(["mid", "new"]);
  });

  it("holds the default cap at 200", () => {
    const recent = new Map<string, number>();
    for (let index = 0; index < 205; index += 1) {
      recent.set(`asset-${index}`, NOW - index);
    }

    const next = pruneRecent(recent, NOW);

    expect(next.size).toBe(RECENT_MAX);
    expect(next.has("asset-0")).toBe(true);
    expect(next.has("asset-204")).toBe(false);
  });
});

describe("catalogueDue", () => {
  const TTL = 6 * 60 * 60 * 1000;

  it("is due when the catalogue has never synced", () => {
    expect(
      catalogueDue({ now: NOW, syncedAt: null, backoffUntil: 0, ttlMs: TTL }),
    ).toBe(true);
  });

  it("keeps the six-hour success TTL", () => {
    expect(
      catalogueDue({
        now: NOW + TTL - 1,
        syncedAt: NOW,
        backoffUntil: 0,
        ttlMs: TTL,
      }),
    ).toBe(false);
    expect(
      catalogueDue({
        now: NOW + TTL,
        syncedAt: NOW,
        backoffUntil: 0,
        ttlMs: TTL,
      }),
    ).toBe(true);
  });

  it("suppresses a retry during the failure backoff", () => {
    const syncedAt = NOW - TTL;

    expect(
      catalogueDue({
        now: NOW + 30_000,
        syncedAt,
        backoffUntil: NOW + 60_000,
        ttlMs: TTL,
      }),
    ).toBe(false);
    expect(
      catalogueDue({
        now: NOW + 60_000,
        syncedAt,
        backoffUntil: NOW + 60_000,
        ttlMs: TTL,
      }),
    ).toBe(true);
  });
});
