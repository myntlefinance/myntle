import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  __resetAssetPriceForTests,
  pickSymbolAsset,
  pickSymbolAssetForHistory,
  pickSymbolPrice,
  prefetchSymbolPrice,
  resolveSymbolPrice,
} from "@/components/app/useAssetPrice";
import {
  __resetPriceStoreForTests,
  getQuote,
} from "@/components/app/priceStore";

const assets = [
  { assetId: "a", symbol: "USDC", chain: "ethereum", priceUsd: 1 },
  { assetId: "b", symbol: "USDC", chain: "near", priceUsd: 1.001 },
  { assetId: "c", symbol: "USDC", chain: "base" },
];

describe("pickSymbolPrice", () => {
  it("prefers the chain the card is showing", () => {
    expect(pickSymbolPrice(assets, "near")).toBe(1.001);
  });

  it("understands the catalogue's chain spelling", () => {
    expect(pickSymbolPrice(assets, "eth")).toBe(1);
    expect(pickSymbolPrice(assets, "ethereum")).toBe(1);
  });

  it("falls back to the first priced match", () => {
    expect(pickSymbolPrice(assets, "arb")).toBe(1);
    expect(pickSymbolPrice(assets, "base")).toBe(1);
    expect(pickSymbolPrice(assets)).toBe(1);
  });

  it("returns undefined when no match carries a price", () => {
    expect(
      pickSymbolPrice([{ assetId: "d", symbol: "XYZ", chain: "near" }]),
    ).toBeUndefined();
  });
});

describe("pickSymbolAsset", () => {
  it("resolves the row, not just the number, for the live store", () => {
    expect(pickSymbolAsset(assets, "near")?.assetId).toBe("b");
    expect(pickSymbolAsset(assets, "base")?.assetId).toBe("c");
    expect(pickSymbolAsset(assets, "sol")?.assetId).toBe("a");
  });
});

describe("pickSymbolAssetForHistory", () => {
  it("uses the chain-matched row for the line", () => {
    expect(pickSymbolAssetForHistory(assets, "near")?.assetId).toBe("b");
    expect(pickSymbolAssetForHistory(assets, "base")?.assetId).toBe("c");
  });

  it("uses the chain row even when the catalogue never priced it", () => {
    expect(
      pickSymbolAssetForHistory(
        [
          { assetId: "a", symbol: "USDC", chain: "ethereum", priceUsd: 1 },
          { assetId: "b", symbol: "USDC", chain: "near" },
        ],
        "near",
      )?.assetId,
    ).toBe("b");
  });

  it("refuses another chain's row when the chain is named", () => {
    expect(pickSymbolAssetForHistory(assets, "sol")).toBeUndefined();
  });

  it("keeps the ordinary pick when no chain is named", () => {
    expect(pickSymbolAssetForHistory(assets)?.assetId).toBe("a");
  });

  it("returns undefined when there are no rows", () => {
    expect(pickSymbolAssetForHistory([], "near")).toBeUndefined();
  });
});

describe("resolveSymbolPrice", () => {
  it("lets the live quote win over the catalogue price", () => {
    const quote = {
      assetId: "b",
      usd: 1.02,
      asOf: 1,
      source: "binance" as const,
      stale: false,
    };
    expect(resolveSymbolPrice({ priceUsd: 1.001 }, quote)).toBe(1.02);
  });

  it("falls back to the catalogue price when the store is empty", () => {
    expect(resolveSymbolPrice({ priceUsd: 1.001 }, undefined)).toBe(1.001);
    expect(resolveSymbolPrice(undefined, undefined)).toBeUndefined();
  });
});

describe("prefetchSymbolPrice", () => {
  beforeEach(() => {
    __resetAssetPriceForTests();
    __resetPriceStoreForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shares one metadata request per symbol and seeds the store", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        assets: [
          {
            assetId: "base-usdc",
            symbol: "USDC",
            chain: "base",
            priceUsd: 1,
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    prefetchSymbolPrice("USDC", "base");
    prefetchSymbolPrice("USDC", "base");

    await vi.waitFor(() => expect(getQuote("base-usdc")?.usd).toBe(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("seeds with the catalogue's observation time", async () => {
    const observed = Date.now() - 5_000;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        assets: [
          {
            assetId: "base-usdc",
            symbol: "USDC",
            chain: "base",
            priceUsd: 1,
            priceAsOf: observed,
            contractAddress: "0x8335",
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    prefetchSymbolPrice("USDC", "base");

    await vi.waitFor(() => expect(getQuote("base-usdc")?.asOf).toBe(observed));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reuses the cached rows instead of fetching again", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        assets: [
          {
            assetId: "near-usdc",
            symbol: "USDC",
            chain: "near",
            priceUsd: 1.001,
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    prefetchSymbolPrice("USDC", "near");
    await vi.waitFor(() => expect(getQuote("near-usdc")?.usd).toBe(1.001));

    prefetchSymbolPrice("USDC", "near");
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
