import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import type { Mock } from "vitest";
import {
  __resetTokenSeriesForTests,
  appendLivePoint,
  fetchTokenSeries,
  prefetchTokenSeriesForSymbol,
  seriesChangePct,
  shouldRetryTokenSeries,
  toChartPoints,
  toChartSeries,
  tokenSeriesInitialData,
  TokenSeriesError,
  tokenHistoryUrl,
  tokenSeriesEnabled,
  tokenSeriesQueryKey,
} from "@/components/app/useTokenSeries";
import { __resetAssetPriceForTests } from "@/components/app/useAssetPrice";
import type { LiveQuote } from "@/components/app/priceStore";

const points = [
  { time: 1_700_000_000_000, value: 100 },
  { time: 1_700_001_800_000, value: 110 },
];

function live(
  overrides: Partial<LiveQuote> = {},
): Pick<LiveQuote, "usd" | "asOf" | "source"> {
  return {
    usd: 120,
    asOf: 1_700_003_600_000,
    source: "binance",
    ...overrides,
  };
}

describe("appendLivePoint", () => {
  it("appends a newer quote from the same source", () => {
    const result = appendLivePoint(points, live(), "binance");

    expect(result.points).toHaveLength(3);
    expect(result.points.at(-1)).toEqual({
      time: 1_700_003_600_000,
      value: 120,
    });
    expect(result.changePct).toBeCloseTo(20, 6);
  });

  it("recomputes the percent from the appended point", () => {
    const result = appendLivePoint(points, live({ usd: 90 }), "binance");

    expect(result.points).toHaveLength(3);
    expect(result.changePct).toBeCloseTo(-10, 6);
  });

  it("does not append a quote from a different source", () => {
    const result = appendLivePoint(points, live({ source: "alchemy" }), "binance");

    expect(result.points).toBe(points);
    expect(result.changePct).toBeCloseTo(10, 6);
  });

  it("does not append a quote older than the last close", () => {
    const result = appendLivePoint(
      points,
      live({ asOf: 1_700_001_000_000 }),
      "binance",
    );

    expect(result.points).toBe(points);
    expect(result.changePct).toBeCloseTo(10, 6);
  });

  it("does not append a quote at the same timestamp as the last close", () => {
    const result = appendLivePoint(
      points,
      live({ asOf: 1_700_001_800_000 }),
      "binance",
    );

    expect(result.points).toBe(points);
  });

  it("keeps an empty series empty so the chart draws no line", () => {
    const result = appendLivePoint([], live(), "binance");

    expect(result.points).toEqual([]);
    expect(result.changePct).toBeNull();
  });

  it("does not append when the series has no source", () => {
    const result = appendLivePoint(points, live(), null);

    expect(result.points).toBe(points);
  });

  it("does not append when there is no live quote", () => {
    const result = appendLivePoint(points, undefined, "binance");

    expect(result.points).toBe(points);
    expect(result.changePct).toBeCloseTo(10, 6);
  });

  it("allows a CoinGecko series to stay on its own last close", () => {
    const result = appendLivePoint(points, live({ source: "binance" }), "coingecko");

    expect(result.points).toBe(points);
    expect(result.points.at(-1)?.value).toBe(110);
  });
});

describe("tokenSeriesEnabled", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is on for an open card with an id and the rollout flag", () => {
    vi.stubEnv("NEXT_PUBLIC_PRICES_LIVE", "1");
    expect(tokenSeriesEnabled("nep141:wrap.near")).toBe(true);
  });

  it("is off when the rollout flag is off, so no chart is fetched", () => {
    vi.stubEnv("NEXT_PUBLIC_PRICES_LIVE", "0");
    expect(tokenSeriesEnabled("nep141:wrap.near")).toBe(false);
  });

  it("stays off for a closed card or a missing id", () => {
    vi.stubEnv("NEXT_PUBLIC_PRICES_LIVE", "1");
    expect(tokenSeriesEnabled("nep141:wrap.near", false)).toBe(false);
    expect(tokenSeriesEnabled(null)).toBe(false);
    expect(tokenSeriesEnabled("  ")).toBe(false);
  });
});

describe("seriesChangePct", () => {
  it("is null without a pair to compare", () => {
    expect(seriesChangePct([])).toBeNull();
    expect(seriesChangePct([points[0]])).toBeNull();
  });

  it("is null when the first value cannot divide", () => {
    expect(
      seriesChangePct([
        { time: 1, value: 0 },
        { time: 2, value: 1 },
      ]),
    ).toBeNull();
  });
});

describe("toChartPoints", () => {
  it("converts the wire's milliseconds to Liveline's seconds", () => {
    expect(toChartPoints([{ time: 1_700_000_000_000, value: 1 }])).toEqual([
      { time: 1_700_000_000, value: 1 },
    ]);
  });
});

describe("toChartSeries", () => {
  it("returns points and asOf in the same seconds unit", () => {
    const chart = toChartSeries(
      [{ time: 1_700_000_000_000, value: 1 }],
      1_700_000_000_000,
    );

    expect(chart.points).toEqual([{ time: 1_700_000_000, value: 1 }]);
    expect(chart.asOf).toBe(1_700_000_000);
  });

  it("keeps a missing watermark null", () => {
    expect(toChartSeries([], null).asOf).toBeNull();
  });
});

describe("shouldRetryTokenSeries", () => {
  it("never retries a 4xx refusal", () => {
    for (const status of [400, 404, 429]) {
      expect(
        shouldRetryTokenSeries(0, new TokenSeriesError("refused", status)),
      ).toBe(false);
    }
  });

  it("retries an outage once and then stops", () => {
    const outage = new TokenSeriesError("unavailable", 503);

    expect(shouldRetryTokenSeries(0, outage)).toBe(true);
    expect(shouldRetryTokenSeries(1, outage)).toBe(false);
  });

  it("retries a transport failure once and then stops", () => {
    const failure = new TypeError("fetch failed");

    expect(shouldRetryTokenSeries(0, failure)).toBe(true);
    expect(shouldRetryTokenSeries(1, failure)).toBe(false);
  });

  it("does not retry a read the card already cancelled", () => {
    const cancelled = new Error("cancelled");
    cancelled.name = "CancelledError";

    expect(shouldRetryTokenSeries(0, cancelled)).toBe(false);
  });
});

describe("fetchTokenSeries", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads a known series and sorts its points", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            assetId: "nep141:wrap.near",
            range: "24h",
            points: [
              { time: 1_700_001_800_000, value: 110 },
              { time: 1_700_000_000_000, value: 100 },
            ],
            changePct: 10,
            source: "binance",
            asOf: 1_700_001_800_000,
            incomplete: false,
          }),
          { status: 200 },
        ),
      ),
    );

    const series = await fetchTokenSeries("nep141:wrap.near");

    expect(series.points).toEqual([
      { time: 1_700_000_000_000, value: 100 },
      { time: 1_700_001_800_000, value: 110 },
    ]);
    expect(series.changePct).toBeCloseTo(10, 6);
    expect(series.source).toBe("binance");
    expect(series.asOf).toBe(1_700_001_800_000);
    expect(series.incomplete).toBe(false);
    expect(series.stale).toBe(false);
  });

  it("treats the unsupported-asset body as an honest empty series", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            assetId: "nep141:unknown",
            range: "24h",
            points: [],
            reason: "no-history",
          }),
          { status: 200 },
        ),
      ),
    );

    const series = await fetchTokenSeries("nep141:unknown");

    expect(series.points).toEqual([]);
    expect(series.changePct).toBeNull();
    expect(series.source).toBeNull();
    expect(series.asOf).toBeNull();
    expect(series.incomplete).toBe(false);
    expect(series.stale).toBe(false);
  });

  it("surfaces a failed route with its status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 503 })),
    );

    await expect(
      fetchTokenSeries("nep141:wrap.near"),
    ).rejects.toMatchObject({
      name: "TokenSeriesError",
      status: 503,
    });
  });

  it("keeps a rate-limit status so the retry policy can refuse it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 429 })),
    );

    await expect(
      fetchTokenSeries("nep141:wrap.near"),
    ).rejects.toMatchObject({
      name: "TokenSeriesError",
      status: 429,
    });
  });
});

describe("tokenSeriesQueryKey", () => {
  it("uses the plan's key", () => {
    expect(tokenSeriesQueryKey("nep141:wrap.near")).toEqual([
      "price-series",
      "nep141:wrap.near",
      "24h",
    ]);
  });

  it("keeps a missing id in the key so the query can stay disabled", () => {
    expect(tokenSeriesQueryKey(undefined)).toEqual([
      "price-series",
      null,
      "24h",
    ]);
  });
});

describe("tokenHistoryUrl", () => {
  it("targets the history route with the asset and range", () => {
    const url = new URL(tokenHistoryUrl("nep141:wrap.near"));

    expect(url.pathname).toBe("/history");
    expect(url.searchParams.get("asset")).toBe("nep141:wrap.near");
    expect(url.searchParams.get("range")).toBe("24h");
  });

  it("encodes an asset id that is not URL-safe", () => {
    const url = tokenHistoryUrl("erc20:0x1234/5678");

    expect(url).toContain("asset=erc20%3A0x1234%2F5678");
  });
});

/* ── viewport prefetch ───────────────────────────────────── */

const prefetchRows = [
  { assetId: "near-usdc", symbol: "USDC", chain: "near", priceUsd: 1.001 },
  { assetId: "eth-usdc", symbol: "USDC", chain: "ethereum", priceUsd: 1 },
];

const prefetchBody = {
  points: [
    { time: 1_700_000_000_000, value: 100 },
    { time: 1_700_001_800_000, value: 110 },
  ],
  changePct: 10,
  source: "binance",
  asOf: 1_700_001_800_000,
};

/** Routes the catalogue read and the history read through one mock. */
function stubPrefetchFetch(rows = prefetchRows) {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes("/api/assets")) {
      return new Response(JSON.stringify({ assets: rows }), { status: 200 });
    }
    if (url.includes("/history")) {
      return new Response(JSON.stringify(prefetchBody), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function historyUrls(fetchMock: Mock): string[] {
  return fetchMock.mock.calls
    .map((call) => String(call[0]))
    .filter((url) => url.includes("/history"));
}

describe("prefetchTokenSeriesForSymbol", () => {
  beforeEach(() => {
    __resetTokenSeriesForTests();
    __resetAssetPriceForTests();
  });

  afterEach(() => {
    __resetTokenSeriesForTests();
    __resetAssetPriceForTests();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("writes the cache and hands it to a later popup as initial data", async () => {
    const fetchMock = stubPrefetchFetch();

    await prefetchTokenSeriesForSymbol("usdc", "near");

    expect(historyUrls(fetchMock)).toEqual([
      expect.stringContaining("asset=near-usdc"),
    ]);
    // This is exactly what useTokenSeries passes to useQuery.
    const initial = tokenSeriesInitialData("near-usdc");
    expect(initial?.initialData.points).toHaveLength(2);
    expect(initial?.initialData.source).toBe("binance");
    expect(initial?.initialDataUpdatedAt).toBeGreaterThan(Date.now() - 1_000);
    expect(initial?.initialDataUpdatedAt).toBeLessThanOrEqual(Date.now());
  });

  it("does not fetch a series that is already fresh", async () => {
    const fetchMock = stubPrefetchFetch();

    await prefetchTokenSeriesForSymbol("USDC", "near");
    await prefetchTokenSeriesForSymbol("USDC", "near");

    expect(historyUrls(fetchMock)).toHaveLength(1);
  });

  it("ignores a cache older than the query's stale window", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = stubPrefetchFetch();
      await prefetchTokenSeriesForSymbol("USDC", "near");
      expect(tokenSeriesInitialData("near-usdc")).toBeDefined();

      vi.advanceTimersByTime(31 * 60_000);
      expect(tokenSeriesInitialData("near-usdc")).toBeUndefined();

      await prefetchTokenSeriesForSymbol("USDC", "near");
      expect(historyUrls(fetchMock)).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does nothing when the rollout flag is off", async () => {
    vi.stubEnv("NEXT_PUBLIC_PRICES_LIVE", "0");
    const fetchMock = stubPrefetchFetch();

    await prefetchTokenSeriesForSymbol("USDC", "near");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(tokenSeriesInitialData("near-usdc")).toBeUndefined();
  });

  it("picks only the row on the requested chain", async () => {
    const fetchMock = stubPrefetchFetch();

    await prefetchTokenSeriesForSymbol("USDC", "near");
    expect(historyUrls(fetchMock)).toEqual([
      expect.stringContaining("asset=near-usdc"),
    ]);

    // A chain the catalogue does not carry must not borrow another chain's
    // line, even though the ticker has priced rows.
    __resetTokenSeriesForTests();
    await prefetchTokenSeriesForSymbol("USDC", "solana");
    expect(historyUrls(fetchMock)).toHaveLength(1);
    expect(tokenSeriesInitialData("eth-usdc")).toBeUndefined();

    await prefetchTokenSeriesForSymbol("USDC", "ethereum");
    expect(historyUrls(fetchMock)).toEqual([
      expect.stringContaining("asset=near-usdc"),
      expect.stringContaining("asset=eth-usdc"),
    ]);
  });

  it("clears the cache on reset", async () => {
    stubPrefetchFetch();
    await prefetchTokenSeriesForSymbol("USDC", "near");
    expect(tokenSeriesInitialData("near-usdc")).toBeDefined();

    __resetTokenSeriesForTests();

    expect(tokenSeriesInitialData("near-usdc")).toBeUndefined();
  });
});
