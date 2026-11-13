import { describe, expect, it } from "vitest";
import { parseCatalogue, shouldPruneAssets } from "../src/catalogue";

const UPDATED_AT = "2026-11-10T13:48:30.764Z";
const UPDATED_AT_MS = Date.parse(UPDATED_AT);

describe("parseCatalogue", () => {
  it("parses the flat array the live endpoint returns", () => {
    const body = [
      {
        assetId: "nep141:wrap.near",
        decimals: 24,
        blockchain: "near",
        symbol: "wNEAR",
        price: 3.6,
        priceUpdatedAt: UPDATED_AT,
        contractAddress: "wrap.near",
        coingeckoId: "wrapped-near",
      },
      {
        assetId: "nep141:eth.bridge.near",
        decimals: 18,
        blockchain: "near",
        symbol: "ETH",
        price: 2069.28,
        priceUpdatedAt: UPDATED_AT,
        contractAddress: "eth.bridge.near",
        coingeckoId: "ethereum",
      },
    ];

    expect(parseCatalogue(body)).toEqual([
      {
        assetId: "nep141:wrap.near",
        symbol: "wNEAR",
        chain: "near",
        contract: "wrap.near",
        decimals: 24,
        coingeckoId: "wrapped-near",
        price: 3.6,
        priceUpdatedAt: UPDATED_AT_MS,
      },
      {
        assetId: "nep141:eth.bridge.near",
        symbol: "ETH",
        chain: "near",
        contract: "eth.bridge.near",
        decimals: 18,
        coingeckoId: "ethereum",
        price: 2069.28,
        priceUpdatedAt: UPDATED_AT_MS,
      },
    ]);
  });

  it("accepts the { data: [...] } wrapper", () => {
    const body = {
      data: [
        {
          assetId: "nep141:usdc",
          blockchain: "near",
          symbol: "USDC",
          contractAddress: "usdc.near",
          decimals: 6,
          coingeckoId: "usd-coin",
          price: 1,
          priceUpdatedAt: UPDATED_AT,
        },
      ],
    };

    expect(parseCatalogue(body)).toEqual([
      {
        assetId: "nep141:usdc",
        symbol: "USDC",
        chain: "near",
        contract: "usdc.near",
        decimals: 6,
        coingeckoId: "usd-coin",
        price: 1,
        priceUpdatedAt: UPDATED_AT_MS,
      },
    ]);
  });

  it("returns an empty list for a body that is not a catalogue", () => {
    expect(parseCatalogue(null)).toEqual([]);
    expect(parseCatalogue(undefined)).toEqual([]);
    expect(parseCatalogue("[]")).toEqual([]);
    expect(parseCatalogue({ code: -1, msg: "bad request" })).toEqual([]);
    expect(parseCatalogue({ data: "not-a-list" })).toEqual([]);
    expect(parseCatalogue({ data: [] })).toEqual([]);
  });

  it("skips rows missing an assetId or a symbol", () => {
    const body = [
      { symbol: "ETH", blockchain: "eth" },
      { assetId: "nep141:eth", blockchain: "eth" },
      { assetId: "   ", symbol: "ETH" },
      { assetId: "nep141:sol", symbol: "   " },
      null,
      "nep141:btc",
      [],
      { assetId: "nep141:btc", symbol: "BTC", blockchain: "btc" },
    ];

    expect(parseCatalogue(body).map((asset) => asset.assetId)).toEqual([
      "nep141:btc",
    ]);
  });

  it("dedupes by assetId with the last row winning", () => {
    const body = [
      {
        assetId: "nep141:eth",
        symbol: "ETH",
        blockchain: "eth",
        price: 1,
      },
      {
        assetId: "nep141:btc",
        symbol: "BTC",
        blockchain: "btc",
        price: 2,
      },
      {
        assetId: "nep141:eth",
        symbol: "ETH",
        blockchain: "eth",
        price: 3,
      },
    ];

    const assets = parseCatalogue(body);

    expect(assets).toHaveLength(2);
    expect(assets.map((asset) => asset.assetId)).toEqual([
      "nep141:eth",
      "nep141:btc",
    ]);
    expect(assets[0]?.price).toBe(3);
  });

  it("keeps the optional fields null when the upstream omits them", () => {
    const [asset] = parseCatalogue([
      { assetId: "nep141:zec", symbol: "ZEC", blockchain: "zec", decimals: 8 },
    ]);

    expect(asset).toEqual({
      assetId: "nep141:zec",
      symbol: "ZEC",
      chain: "zec",
      contract: null,
      decimals: 8,
      coingeckoId: null,
      price: null,
      priceUpdatedAt: null,
    });
  });

  it("treats a blank contract, chain, or coingeckoId as absent", () => {
    const [asset] = parseCatalogue([
      {
        assetId: "nep141:btc",
        symbol: "BTC",
        blockchain: "  ",
        contractAddress: "  ",
        coingeckoId: "",
      },
    ]);

    expect(asset?.chain).toBe("");
    expect(asset?.contract).toBeNull();
    expect(asset?.coingeckoId).toBeNull();
  });

  it("requires decimals to be a non-negative integer and defaults to 0", () => {
    const body = [
      { assetId: "a", symbol: "A", decimals: 18 },
      { assetId: "b", symbol: "B", decimals: "6" },
      { assetId: "c", symbol: "C" },
      { assetId: "d", symbol: "D", decimals: 18.5 },
      { assetId: "e", symbol: "E", decimals: -1 },
      { assetId: "f", symbol: "F", decimals: "abc" },
      { assetId: "g", symbol: "G", decimals: null },
    ];

    expect(
      parseCatalogue(body).map((asset) => [asset.assetId, asset.decimals]),
    ).toEqual([
      ["a", 18],
      ["b", 6],
      ["c", 0],
      ["d", 0],
      ["e", 0],
      ["f", 0],
      ["g", 0],
    ]);
  });

  it("keeps a finite price including zero, and drops nonsense", () => {
    const body = [
      { assetId: "a", symbol: "A", price: 3.6 },
      { assetId: "b", symbol: "B", price: "1.25" },
      { assetId: "c", symbol: "C", price: 0 },
      { assetId: "d", symbol: "D" },
      { assetId: "e", symbol: "E", price: -2 },
      { assetId: "f", symbol: "F", price: "not-a-number" },
      { assetId: "g", symbol: "G", price: null },
      { assetId: "h", symbol: "H", price: true },
    ];

    expect(parseCatalogue(body).map((asset) => asset.price)).toEqual([
      3.6,
      1.25,
      0,
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it("converts priceUpdatedAt to epoch milliseconds", () => {
    const body = [
      { assetId: "a", symbol: "A", priceUpdatedAt: UPDATED_AT },
      { assetId: "b", symbol: "B", priceUpdatedAt: 1_762_000_000_000 },
      { assetId: "c", symbol: "C", priceUpdatedAt: 1_762_000_000 },
      { assetId: "d", symbol: "D", priceUpdatedAt: "yesterday" },
      { assetId: "e", symbol: "E", priceUpdatedAt: 0 },
      { assetId: "f", symbol: "F" },
    ];

    expect(
      parseCatalogue(body).map((asset) => asset.priceUpdatedAt),
    ).toEqual([
      UPDATED_AT_MS,
      1_762_000_000_000,
      1_762_000_000_000,
      null,
      null,
      null,
    ]);
  });
});

describe("shouldPruneAssets", () => {
  it("prunes when the registry is the same size", () => {
    expect(shouldPruneAssets(100, 100)).toBe(true);
  });

  it("prunes at exactly 80%", () => {
    expect(shouldPruneAssets(100, 80)).toBe(true);
    expect(shouldPruneAssets(229, 184)).toBe(true);
  });

  it("keeps the old rows below 80%", () => {
    expect(shouldPruneAssets(100, 79)).toBe(false);
    expect(shouldPruneAssets(229, 183)).toBe(false);
    expect(shouldPruneAssets(229, 150)).toBe(false);
  });

  it("prunes on the first sync, when there is nothing to protect", () => {
    expect(shouldPruneAssets(0, 229)).toBe(true);
    expect(shouldPruneAssets(0, 1)).toBe(true);
  });

  it("never prunes against an empty new registry", () => {
    expect(shouldPruneAssets(229, 0)).toBe(false);
  });
});
