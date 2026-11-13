import { describe, expect, it } from "vitest";
import type { FetchLike } from "../src/lib/http";
import { createSources } from "../src/sources";
import {
  createPriceResolver,
  type ResolverAsset,
} from "../src/sources/resolve";
import type { SourceConfig } from "../src/sources/types";

const NOW = 1_762_000_000_000;
const UPDATED_AT = "2026-11-10T13:48:30.764Z";

function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function route(handler: (url: URL) => Response | undefined) {
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    calls.push(url);
    return handler(new URL(url)) ?? json({}, 500);
  };
  return { calls, fetchImpl };
}

function resolverFor(config: SourceConfig = {}) {
  return createPriceResolver(createSources(config), config);
}

function baseAsset(overrides: Partial<ResolverAsset> = {}): ResolverAsset {
  return {
    assetId: "nep141:wrap.near",
    symbol: "wNEAR",
    sources: ["binance", "alchemy", "oneclick"],
    binanceSymbol: "NEARUSDT",
    alchemySymbol: "NEAR",
    coingeckoId: "wrapped-near",
    ...overrides,
  };
}

function batchAsset(
  index: number,
  overrides: Partial<ResolverAsset> = {},
): ResolverAsset {
  return {
    assetId: `asset-${index}`,
    symbol: `T${index}`,
    sources: ["binance", "alchemy", "oneclick"],
    binanceSymbol: `T${index}USDT`,
    alchemySymbol: `T${index}`,
    coingeckoId: null,
    ...overrides,
  };
}

function alchemyQuote(): Response {
  return json({
    data: [
      {
        symbol: "NEAR",
        prices: [
          { currency: "usd", value: "3.61", lastUpdatedAt: UPDATED_AT },
        ],
      },
    ],
  });
}

function oneclickQuote(): Response {
  return json([
    {
      assetId: "nep141:wrap.near",
      symbol: "wNEAR",
      price: 3.62,
      priceUpdatedAt: UPDATED_AT,
    },
  ]);
}

function historicalPoints(count = 48): { value: string; timestamp: string }[] {
  return Array.from({ length: count }, (_, index) => ({
    value: String(100 + index),
    timestamp: new Date(NOW - (count - 1 - index) * 300_000).toISOString(),
  }));
}

function candles(count = 48): unknown[] {
  return Array.from({ length: count }, (_, index) => [
    NOW - (count - 1 - index) * 1_800_000,
    100 + index,
    101 + index,
    99 + index,
    100 + index,
  ]);
}

function binanceCalls(calls: string[]): string[] {
  return calls.filter((url) => url.includes("binance.us"));
}

function alchemyCalls(calls: string[]): string[] {
  return calls.filter((url) => url.includes("api.g.alchemy.com"));
}

function oneclickCalls(calls: string[]): string[] {
  return calls.filter((url) => url.includes("1click.chaindefuser.com"));
}

/** A router that answers every batch adapter from the supplied assets. */
function batchHandler(
  catalogue: ResolverAsset[],
): (url: URL) => Response | undefined {
  return (url) => {
    if (url.host.endsWith("binance.us")) {
      const symbols = JSON.parse(
        url.searchParams.get("symbols") ?? "[]",
      ) as string[];
      return json(symbols.map((symbol) => ({ symbol, price: "1" })));
    }

    if (url.host === "api.g.alchemy.com") {
      const symbols = (url.searchParams.get("symbols") ?? "")
        .split(",")
        .filter((symbol) => symbol.length > 0);
      return json({
        data: symbols.map((symbol) => ({
          symbol,
          prices: [
            { currency: "usd", value: "1", lastUpdatedAt: UPDATED_AT },
          ],
        })),
      });
    }

    if (url.host === "1click.chaindefuser.com") {
      return json(
        catalogue.map((asset) => ({
          assetId: asset.assetId,
          symbol: asset.symbol,
          price: 1,
          priceUpdatedAt: UPDATED_AT,
        })),
      );
    }

    return undefined;
  };
}

describe("resolver current", () => {
  it("falls from a failing Binance.US host to Alchemy", async () => {
    const { calls, fetchImpl } = route((url) => {
      if (url.host.endsWith("binance.us")) return json({}, 451);
      if (url.host === "api.g.alchemy.com") return alchemyQuote();
      return undefined;
    });
    const resolver = resolverFor({
      alchemyKey: "k",
      now: () => NOW,
      fetchImpl,
    });

    const result = await resolver.current(baseAsset());

    expect(result).toEqual({
      ok: true,
      value: {
        assetId: "nep141:wrap.near",
        symbol: "NEAR",
        usd: 3.61,
        asOf: Date.parse(UPDATED_AT),
        source: "alchemy",
      },
    });
    // All three US hosts answered 451 before Alchemy was tried.
    expect(binanceCalls(calls)).toHaveLength(3);
    expect(oneclickCalls(calls)).toHaveLength(0);
  });

  it("falls to 1Click after Binance.US and Alchemy both fail", async () => {
    const { calls, fetchImpl } = route((url) => {
      if (url.host.endsWith("binance.us")) return json({}, 451);
      if (url.host === "api.g.alchemy.com") return json({}, 400);
      if (url.host === "1click.chaindefuser.com") return oneclickQuote();
      return undefined;
    });
    const resolver = resolverFor({
      alchemyKey: "k",
      now: () => NOW,
      fetchImpl,
    });

    const result = await resolver.current(baseAsset());

    expect(result).toEqual({
      ok: true,
      value: {
        assetId: "nep141:wrap.near",
        symbol: "wNEAR",
        usd: 3.62,
        asOf: Date.parse(UPDATED_AT),
        source: "oneclick",
      },
    });
    expect(oneclickCalls(calls)).toHaveLength(1);
  });

  it("returns the last reason and the attempt trail when every source fails", async () => {
    const { fetchImpl } = route((url) => {
      if (url.host.endsWith("binance.us")) return json({}, 451);
      if (url.host === "api.g.alchemy.com") return json({}, 400);
      if (url.host === "1click.chaindefuser.com") return json({}, 500);
      return undefined;
    });
    const resolver = resolverFor({
      alchemyKey: "k",
      now: () => NOW,
      fetchImpl,
    });

    const result = await resolver.current(baseAsset());

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error).toBe("http-500");
    expect(result.status).toBe(500);
    expect(result.attempts?.map((attempt) => attempt.source)).toEqual([
      "binance",
      "alchemy",
      "oneclick",
    ]);
    expect(result.attempts?.[0]).toEqual({
      source: "binance",
      error: "http-451",
      status: 451,
    });
    expect(result.attempts?.[1]).toEqual({
      source: "alchemy",
      error: "unsupported",
      status: 400,
    });
  });

  it("respects the registry's source order", async () => {
    const { calls, fetchImpl } = route((url) => {
      if (url.host === "1click.chaindefuser.com") return oneclickQuote();
      if (url.host.endsWith("binance.us")) return json({}, 451);
      return undefined;
    });
    const resolver = resolverFor({
      alchemyKey: "k",
      now: () => NOW,
      fetchImpl,
    });

    const result = await resolver.current(
      baseAsset({ sources: ["oneclick", "binance"] }),
    );

    expect(result.ok && result.value.source).toBe("oneclick");
    expect(binanceCalls(calls)).toHaveLength(0);
  });

  it("skips Alchemy without a key instead of making a call", async () => {
    const { calls, fetchImpl } = route((url) => {
      if (url.host === "1click.chaindefuser.com") return oneclickQuote();
      return undefined;
    });
    const resolver = resolverFor({ now: () => NOW, fetchImpl });

    const result = await resolver.current(
      baseAsset({ sources: ["alchemy", "oneclick"] }),
    );

    expect(result.ok && result.value.source).toBe("oneclick");
    expect(alchemyCalls(calls)).toHaveLength(0);
  });

  it("fails an asset with no mappings and no key without a call", async () => {
    const { calls, fetchImpl } = route(() => undefined);
    const resolver = resolverFor({ fetchImpl });

    const result = await resolver.current(
      baseAsset({
        sources: ["binance", "alchemy"],
        binanceSymbol: null,
        alchemySymbol: null,
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("not-configured");
    expect(result.attempts).toEqual([
      { source: "binance", error: "no-symbol" },
      { source: "alchemy", error: "not-configured" },
    ]);
    expect(calls).toHaveLength(0);
  });

  it("attaches the registry assetId to a Binance quote", async () => {
    const { fetchImpl } = route((url) => {
      if (url.host.endsWith("binance.us")) {
        return json([{ symbol: "NEARUSDT", price: "3.60" }]);
      }
      return undefined;
    });
    const resolver = resolverFor({ now: () => NOW, fetchImpl });

    const result = await resolver.current(baseAsset());

    expect(result).toEqual({
      ok: true,
      value: {
        assetId: "nep141:wrap.near",
        symbol: "NEARUSDT",
        usd: 3.6,
        asOf: NOW,
        source: "binance",
      },
    });
  });
});

describe("resolver currentBatch", () => {
  it("prices 10 Binance-primary assets with one ticker call", async () => {
    const assets = Array.from({ length: 10 }, (_, index) =>
      batchAsset(index),
    );
    const { calls, fetchImpl } = route(batchHandler(assets));
    const resolver = resolverFor({ now: () => NOW, fetchImpl });

    const result = await resolver.currentBatch(assets);

    expect(result.quotes.size).toBe(10);
    expect(result.failures.size).toBe(0);
    expect(result.attempts).toEqual([
      { source: "binance", assets: 10, ok: true },
    ]);
    expect(binanceCalls(calls)).toHaveLength(1);
  });

  it("makes one call per source in the first round of a mixed batch", async () => {
    const assets = [
      batchAsset(0),
      batchAsset(1),
      batchAsset(2),
      batchAsset(3, { sources: ["alchemy", "oneclick"] }),
      batchAsset(4, { sources: ["alchemy", "oneclick"] }),
      batchAsset(5, {
        sources: ["oneclick"],
        binanceSymbol: null,
        alchemySymbol: null,
      }),
      batchAsset(6, {
        sources: ["oneclick"],
        binanceSymbol: null,
        alchemySymbol: null,
      }),
    ];
    const { calls, fetchImpl } = route(batchHandler(assets));
    const resolver = resolverFor({
      alchemyKey: "k",
      now: () => NOW,
      fetchImpl,
    });

    const result = await resolver.currentBatch(assets);

    expect(result.quotes.size).toBe(7);
    expect(result.failures.size).toBe(0);
    expect(binanceCalls(calls)).toHaveLength(1);
    expect(alchemyCalls(calls)).toHaveLength(1);
    expect(oneclickCalls(calls)).toHaveLength(1);
  });

  it("falls a failed Binance batch to Alchemy in one call", async () => {
    const assets = Array.from({ length: 3 }, (_, index) =>
      batchAsset(index),
    );
    const { calls, fetchImpl } = route((url) => {
      if (url.host.endsWith("binance.us")) return json({}, 451);
      if (url.host === "api.g.alchemy.com") {
        const symbols = (url.searchParams.get("symbols") ?? "")
          .split(",")
          .filter((symbol) => symbol.length > 0);
        return json({
          data: symbols.map((symbol) => ({
            symbol,
            prices: [
              { currency: "usd", value: "2", lastUpdatedAt: UPDATED_AT },
            ],
          })),
        });
      }
      return undefined;
    });
    const resolver = resolverFor({
      alchemyKey: "k",
      now: () => NOW,
      fetchImpl,
    });

    const result = await resolver.currentBatch(assets);

    expect(result.quotes.size).toBe(3);
    expect(
      [...result.quotes.values()].every((quote) => quote.source === "alchemy"),
    ).toBe(true);
    expect(binanceCalls(calls)).toHaveLength(3);
    expect(alchemyCalls(calls)).toHaveLength(1);
    expect(result.attempts).toEqual([
      {
        source: "binance",
        assets: 3,
        ok: false,
        error: "http-451",
        status: 451,
      },
      { source: "alchemy", assets: 3, ok: true },
    ]);
  });

  it("fetches the 1Click catalogue once for 39 1Click-only assets", async () => {
    const assets = Array.from({ length: 39 }, (_, index) =>
      batchAsset(index, {
        sources: ["oneclick"],
        binanceSymbol: null,
        alchemySymbol: null,
      }),
    );
    const { calls, fetchImpl } = route(batchHandler(assets));
    const resolver = resolverFor({ now: () => NOW, fetchImpl });

    const result = await resolver.currentBatch(assets);

    expect(result.quotes.size).toBe(39);
    expect(result.failures.size).toBe(0);
    expect(oneclickCalls(calls)).toHaveLength(1);
  });

  it("respects an Alchemy-first asset", async () => {
    const asset = batchAsset(0, { sources: ["alchemy", "binance"] });
    const { calls, fetchImpl } = route(batchHandler([asset]));
    const resolver = resolverFor({
      alchemyKey: "k",
      now: () => NOW,
      fetchImpl,
    });

    const result = await resolver.currentBatch([asset]);

    expect(result.quotes.get(asset.assetId)?.source).toBe("alchemy");
    expect(binanceCalls(calls)).toHaveLength(0);
  });

  it("skips Alchemy for a whole batch when no key is set", async () => {
    const assets = [
      batchAsset(0, { sources: ["alchemy", "oneclick"] }),
      batchAsset(1, { sources: ["alchemy", "oneclick"] }),
    ];
    const { calls, fetchImpl } = route(batchHandler(assets));
    const resolver = resolverFor({ now: () => NOW, fetchImpl });

    const result = await resolver.currentBatch(assets);

    expect(result.quotes.size).toBe(2);
    expect(
      [...result.quotes.values()].every(
        (quote) => quote.source === "oneclick",
      ),
    ).toBe(true);
    expect(alchemyCalls(calls)).toHaveLength(0);
    expect(oneclickCalls(calls)).toHaveLength(1);
  });
});

describe("resolver series", () => {
  it("falls from Binance history to Alchemy's 48 points", async () => {
    const { calls, fetchImpl } = route((url) => {
      if (url.host.endsWith("binance.us")) return json({}, 451);
      if (
        url.host === "api.g.alchemy.com" &&
        url.pathname.endsWith("/tokens/historical")
      ) {
        return json({ data: historicalPoints() });
      }
      return undefined;
    });
    const resolver = resolverFor({
      alchemyKey: "k",
      now: () => NOW,
      fetchImpl,
    });

    const result = await resolver.series(baseAsset());

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.source).toBe("alchemy");
    expect(result.value.points).toHaveLength(48);
    expect(result.value.points[0]?.value).toBe(100);
    expect(result.value.points.at(-1)?.value).toBe(147);
    expect(calls.some((url) => url.includes("coingecko"))).toBe(false);
  });

  it("moves past an empty Alchemy history to CoinGecko", async () => {
    const { calls, fetchImpl } = route((url) => {
      if (url.host.endsWith("binance.us")) return json({}, 451);
      if (
        url.host === "api.g.alchemy.com" &&
        url.pathname.endsWith("/tokens/historical")
      ) {
        return json({ data: [] });
      }
      if (url.host === "api.coingecko.com") return json(candles());
      return undefined;
    });
    const resolver = resolverFor({
      alchemyKey: "k",
      now: () => NOW,
      fetchImpl,
    });

    const result = await resolver.series(baseAsset());

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.source).toBe("coingecko");
    expect(result.value.points).toHaveLength(48);
    expect(calls.some((url) => url.includes("coingecko"))).toBe(true);
  });

  it("falls from both real sources to CoinGecko history", async () => {
    const { calls, fetchImpl } = route((url) => {
      if (url.host.endsWith("binance.us")) return json({}, 451);
      if (url.host === "api.g.alchemy.com") return json({}, 400);
      if (url.host === "api.coingecko.com") return json(candles());
      return undefined;
    });
    const resolver = resolverFor({
      alchemyKey: "k",
      now: () => NOW,
      fetchImpl,
    });

    const result = await resolver.series(baseAsset());

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.source).toBe("coingecko");
    expect(calls.some((url) => url.includes("coingecko"))).toBe(true);
  });

  it("reports no-history for a 1Click-only asset without a call", async () => {
    const { calls, fetchImpl } = route(() => undefined);
    const resolver = resolverFor({ alchemyKey: "k", fetchImpl });

    const result = await resolver.series(
      baseAsset({
        sources: ["oneclick"],
        binanceSymbol: null,
        alchemySymbol: null,
        coingeckoId: null,
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error).toBe("no-history");
    expect(
      result.attempts?.map((attempt) => [attempt.source, attempt.error]),
    ).toEqual([
      ["binance", "no-symbol"],
      ["alchemy", "no-symbol"],
      ["coingecko", "no-symbol"],
    ]);
    expect(calls).toHaveLength(0);
  });

  it("skips Alchemy history without a key and uses CoinGecko", async () => {
    const { calls, fetchImpl } = route((url) => {
      if (url.host === "api.coingecko.com") return json(candles());
      return undefined;
    });
    const resolver = resolverFor({ now: () => NOW, fetchImpl });

    const result = await resolver.series(
      baseAsset({
        binanceSymbol: null,
        alchemySymbol: "NEAR",
        coingeckoId: "near",
      }),
    );

    expect(result.ok && result.value.source).toBe("coingecko");
    expect(alchemyCalls(calls)).toHaveLength(0);
  });
});
