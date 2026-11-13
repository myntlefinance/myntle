import { describe, expect, it } from "vitest";
import type { RawAsset } from "../src/catalogue";
import {
  buildRegistry,
  LIQUID_SYMBOLS,
  type RegistryAsset,
} from "../src/registry";

const UPDATED_AT = 1_762_000_000_000;

const raw = (
  asset: Partial<RawAsset> & Pick<RawAsset, "assetId" | "symbol">,
): RawAsset => ({
  chain: "eth",
  contract: null,
  decimals: 18,
  coingeckoId: "ethereum",
  price: 2069.28,
  priceUpdatedAt: UPDATED_AT,
  ...asset,
});

const build = (
  assets: RawAsset[],
  pairs: string[] = [],
): RegistryAsset[] => buildRegistry(assets, new Set(pairs));

const one = (
  asset: Partial<RawAsset> & Pick<RawAsset, "assetId" | "symbol">,
  pairs: string[] = [],
): RegistryAsset => build([raw(asset)], pairs)[0]!;

describe("buildRegistry aliases", () => {
  it("prices WETH as ETH through the ETHUSDT pair", () => {
    const asset = one(
      {
        assetId: "erc20:weth",
        symbol: "WETH",
        contract: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
      },
      ["ETHUSDT"],
    );

    expect(asset.binanceSymbol).toBe("ETHUSDT");
    expect(asset.alchemySymbol).toBe("ETH");
    expect(asset.primarySource).toBe("binance");
    expect(asset.sources).toEqual(["binance", "alchemy", "oneclick"]);
  });

  it("prices wNEAR as NEAR through the NEARUSDT pair", () => {
    const asset = one(
      {
        assetId: "nep141:wrap.near",
        symbol: "wNEAR",
        chain: "near",
        contract: "wrap.near",
        coingeckoId: "wrapped-near",
      },
      ["NEARUSDT"],
    );

    expect(asset.binanceSymbol).toBe("NEARUSDT");
    expect(asset.alchemySymbol).toBe("NEAR");
    expect(asset.primarySource).toBe("binance");
  });

  it("prices WBTC, cbBTC, xBTC and BTC(OMNI) as BTC", () => {
    const assets = build(
      [
        raw({ assetId: "wbtc", symbol: "WBTC", coingeckoId: "wrapped-bitcoin" }),
        raw({ assetId: "cbbtc", symbol: "cbBTC", coingeckoId: "coinbase-wrapped-btc" }),
        raw({ assetId: "xbtc", symbol: "xBTC", chain: "sol", coingeckoId: "bitcoin" }),
        raw({ assetId: "btc-omni", symbol: "BTC(OMNI)", chain: "btc", coingeckoId: "bitcoin" }),
      ],
      ["BTCUSDT"],
    );

    expect(assets.map((asset) => asset.binanceSymbol)).toEqual([
      "BTCUSDT",
      "BTCUSDT",
      "BTCUSDT",
      "BTCUSDT",
    ]);
    expect(assets.map((asset) => asset.alchemySymbol)).toEqual([
      "BTC",
      "BTC",
      "BTC",
      "BTC",
    ]);
  });

  it("keeps USDT0 as its own identity instead of borrowing USDT", () => {
    const asset = one(
      {
        assetId: "erc20:usdt0",
        symbol: "USDT0",
        chain: "arb",
        coingeckoId: "usdt0",
      },
      ["USDTUSDT", "USDTUSD", "USDTUSDC"],
    );

    // No alias: a USDT0USDT pair would be the only way to Binance, and the
    // symbol stays USDT0 for Alchemy instead of becoming USDT.
    expect(asset.binanceSymbol).toBeNull();
    expect(asset.alchemySymbol).toBe("USDT0");
    expect(asset.alchemySymbol).not.toBe("USDT");
    expect(asset.primarySource).toBe("alchemy");
    expect(asset.sources).toEqual(["alchemy", "oneclick"]);
  });

  it("never aliases a staked derivative to its underlying", () => {
    const asset = one(
      {
        assetId: "nep141:meta-pool.near",
        symbol: "stNEAR",
        chain: "near",
        contract: "meta-pool.near",
        coingeckoId: "staked-near",
      },
      ["NEARUSDT", "BTCUSDT"],
    );

    expect(asset.binanceSymbol).toBeNull();
    expect(asset.alchemySymbol).toBe("STNEAR");
    expect(asset.primarySource).toBe("alchemy");
    expect(asset.sources).toEqual(["alchemy", "oneclick"]);
  });

  it("does not alias the staked USDC variants either", () => {
    const assets = build(
      [
        raw({
          assetId: "susdc",
          symbol: "sUSDC",
          chain: "base",
          coingeckoId: "usd-coin",
        }),
        raw({
          assetId: "wsteth",
          symbol: "wstETH",
          coingeckoId: "wrapped-steth",
        }),
      ],
      ["USDCUSDT", "ETHUSDT"],
    );

    expect(assets[0]?.alchemySymbol).toBe("SUSDC");
    expect(assets[1]?.alchemySymbol).toBe("WSTETH");
    expect(assets.map((asset) => asset.binanceSymbol)).toEqual([null, null]);
  });
});

describe("buildRegistry source precedence", () => {
  it("falls back from USDT to Alchemy because no USDT pair exists", () => {
    const asset = one(
      {
        assetId: "erc20:usdt",
        symbol: "USDT",
        contract: "0xdac17f958d2ee523a2206206994597c13d831ec7",
        coingeckoId: "tether",
      },
      ["BTCUSDT", "ETHUSDT"],
    );

    expect(asset.binanceSymbol).toBeNull();
    expect(asset.alchemySymbol).toBe("USDT");
    expect(asset.primarySource).toBe("alchemy");
    expect(asset.sources).toEqual(["alchemy", "oneclick"]);
  });

  it("keeps USDT on Alchemy when a live-shaped USDTUSD pair exists", () => {
    const asset = one(
      {
        assetId: "erc20:usdt",
        symbol: "USDT",
        contract: "0xdac17f958d2ee523a2206206994597c13d831ec7",
        coingeckoId: "tether",
        decimals: 6,
      },
      ["USDTUSD"],
    );

    expect(asset.binanceSymbol).toBe("USDTUSD");
    expect(asset.alchemySymbol).toBe("USDT");
    expect(asset.primarySource).toBe("alchemy");
    expect(asset.sources).toEqual(["alchemy", "binance", "oneclick"]);
  });

  it("maps USDC.e to USDC only when the coingeckoId proves it", () => {
    const asset = one(
      {
        assetId: "erc20:usdc.e",
        symbol: "USDC.e",
        chain: "pol",
        contract: "0x2791bca1f2de4661ed88a30c99a7a9449aa84174",
        coingeckoId: "usd-coin",
        decimals: 6,
      },
      ["USDCUSDT"],
    );

    expect(asset.binanceSymbol).toBe("USDCUSDT");
    expect(asset.alchemySymbol).toBe("USDC");
    expect(asset.primarySource).toBe("binance");
  });

  it("refuses USDC.e with a wrong or missing coingeckoId", () => {
    const wrong = one(
      {
        assetId: "pol:usdc.e-wrong",
        symbol: "USDC.e",
        chain: "pol",
        coingeckoId: "some-other-usdc",
      },
      ["USDCUSDT"],
    );
    const missing = one(
      {
        assetId: "pol:usdc.e-missing",
        symbol: "USDC.e",
        chain: "pol",
        coingeckoId: null,
      },
      ["USDCUSDT"],
    );

    for (const asset of [wrong, missing]) {
      expect(asset.binanceSymbol).toBeNull();
      expect(asset.alchemySymbol).toBeNull();
      expect(asset.primarySource).toBe("oneclick");
      expect(asset.sources).toEqual(["oneclick"]);
    }
  });

  it("maps a real USDC to the USDCUSDT pair", () => {
    const asset = one(
      {
        assetId: "erc20:usdc",
        symbol: "USDC",
        contract: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        coingeckoId: "usd-coin",
        decimals: 6,
      },
      ["USDCUSDT"],
    );

    expect(asset.binanceSymbol).toBe("USDCUSDT");
    expect(asset.alchemySymbol).toBe("USDC");
    expect(asset.primarySource).toBe("binance");
  });

  it("refuses a USDC whose coingeckoId does not match usd-coin", () => {
    const asset = one(
      {
        assetId: "obscure:usdc",
        symbol: "USDC",
        chain: "unknown",
        coingeckoId: "some-other-usdc",
      },
      ["USDCUSDT", "USDCUSD"],
    );

    expect(asset.binanceSymbol).toBeNull();
    expect(asset.alchemySymbol).toBeNull();
    expect(asset.primarySource).toBe("oneclick");
    expect(asset.sources).toEqual(["oneclick"]);
  });

  it("refuses a USDC with no coingeckoId at all", () => {
    const asset = one(
      { assetId: "obscure:usdc", symbol: "USDC", coingeckoId: null },
      ["USDCUSDT"],
    );

    expect(asset.binanceSymbol).toBeNull();
    expect(asset.alchemySymbol).toBeNull();
    expect(asset.primarySource).toBe("oneclick");
  });

  it("gives an unknown long-tail with a coingeckoId the Alchemy path", () => {
    const asset = one({
      assetId: "erc20:mog",
      symbol: "MOG",
      contract: "0xaaee1a9723aadb7afa2810263653a34ba2c21c7a",
      coingeckoId: "mog-coin",
    });

    expect(asset.binanceSymbol).toBeNull();
    expect(asset.alchemySymbol).toBe("MOG");
    expect(asset.primarySource).toBe("alchemy");
    expect(asset.sources).toEqual(["alchemy", "oneclick"]);
  });

  it("gives a long-tail with no coingeckoId nothing but the catalogue", () => {
    const asset = one(
      {
        assetId: "erc20:tlo",
        symbol: "TLO",
        coingeckoId: null,
      },
      ["TLOUSDT"],
    );

    expect(asset.binanceSymbol).toBeNull();
    expect(asset.alchemySymbol).toBeNull();
    expect(asset.primarySource).toBe("oneclick");
    expect(asset.sources).toEqual(["oneclick"]);
  });

  it("prefers Alchemy over a pair for a non-liquid asset", () => {
    const asset = one(
      {
        assetId: "base:brett",
        symbol: "BRETT",
        chain: "base",
        coingeckoId: "based-brett",
      },
      ["BRETTUSDT"],
    );

    expect(asset.binanceSymbol).toBe("BRETTUSDT");
    expect(asset.alchemySymbol).toBe("BRETT");
    expect(asset.primarySource).toBe("alchemy");
    expect(asset.sources).toEqual(["alchemy", "binance", "oneclick"]);
  });

  it("prefers USDT over USD over USDC for the same ticker", () => {
    const assets = build(
      [
        raw({ assetId: "a", symbol: "ETH" }),
        raw({ assetId: "b", symbol: "ETH" }),
        raw({ assetId: "c", symbol: "ETH" }),
      ],
      ["ETHUSDT", "ETHUSD", "ETHUSDC"],
    );

    expect(assets.map((asset) => asset.binanceSymbol)).toEqual([
      "ETHUSDT",
      "ETHUSDT",
      "ETHUSDT",
    ]);

    const usdOnly = one(
      { assetId: "d", symbol: "ETH" },
      ["ETHUSD", "ETHUSDC"],
    );
    expect(usdOnly.binanceSymbol).toBe("ETHUSD");

    const usdcOnly = one({ assetId: "e", symbol: "ETH" }, ["ETHUSDC"]);
    expect(usdcOnly.binanceSymbol).toBe("ETHUSDC");
  });

  it("keeps a denylisted ticker off Alchemy", () => {
    const asset = one({ assetId: "near:abg", symbol: "ABG", coingeckoId: "abg" });

    expect(asset.alchemySymbol).toBeNull();
    expect(asset.primarySource).toBe("oneclick");
  });

  it("does not offer Alchemy for a ticker with punctuation", () => {
    const asset = one({
      assetId: "sol:wif",
      symbol: "$WIF",
      chain: "sol",
      coingeckoId: "dogwifcoin",
    });

    expect(asset.alchemySymbol).toBeNull();
    expect(asset.primarySource).toBe("oneclick");
  });

  it("populates the Alchemy network and address for a known chain", () => {
    const asset = one({
      assetId: "base:weth",
      symbol: "WETH",
      chain: "base",
      contract: "0x4200000000000000000000000000000000000006",
      coingeckoId: "ethereum",
    });

    expect(asset.alchemyNetwork).toBe("base-mainnet");
    expect(asset.alchemyAddress).toBe(
      "0x4200000000000000000000000000000000000006",
    );
  });

  it("leaves the network null on a chain Alchemy does not serve", () => {
    const asset = one({
      assetId: "aptos:usdc",
      symbol: "USDC",
      chain: "aptos",
      coingeckoId: "usd-coin",
    });

    expect(asset.alchemyNetwork).toBeNull();
  });

  it("maps the confident L2 slugs and leaves an unverified one null", () => {
    const assets = build(
      [
        raw({ assetId: "scroll:x", symbol: "SCX", chain: "scroll" }),
        raw({ assetId: "linea:x", symbol: "LNX", chain: "linea" }),
        raw({ assetId: "hood:x", symbol: "HDX", chain: "hood" }),
      ],
      [],
    );

    expect(assets[0]?.alchemyNetwork).toBe("scroll-mainnet");
    expect(assets[1]?.alchemyNetwork).toBe("linea-mainnet");
    expect(assets[2]?.alchemyNetwork).toBeNull();
  });
});

describe("buildRegistry fallback plan", () => {
  it("leads with the primary source, has no duplicates, and ends in oneclick", () => {
    const assets = build(
      [
        raw({ assetId: "weth", symbol: "WETH" }),
        raw({
          assetId: "usdt",
          symbol: "USDT",
          coingeckoId: "tether",
        }),
        raw({
          assetId: "brett",
          symbol: "BRETT",
          chain: "base",
          coingeckoId: "based-brett",
        }),
        raw({
          assetId: "stnear",
          symbol: "stNEAR",
          chain: "near",
          coingeckoId: "staked-near",
        }),
        raw({ assetId: "tlo", symbol: "TLO", coingeckoId: null }),
        raw({
          assetId: "fake-usdc",
          symbol: "USDC",
          coingeckoId: "not-usd-coin",
        }),
      ],
      ["ETHUSDT", "USDTUSD", "BRETTUSDT", "NEARUSDT"],
    );

    for (const asset of assets) {
      expect(asset.sources[0]).toBe(asset.primarySource);
      expect(new Set(asset.sources).size).toBe(asset.sources.length);
      expect(asset.sources.at(-1)).toBe("oneclick");
      if (asset.primarySource === "oneclick") {
        expect(asset.sources).toEqual(["oneclick"]);
        expect(asset.binanceSymbol).toBeNull();
        expect(asset.alchemySymbol).toBeNull();
      }
    }
  });

  it("carries the catalogue price and its timestamp through", () => {
    const asset = one({
      assetId: "near:zec",
      symbol: "ZEC",
      chain: "near",
      coingeckoId: "zcash",
      price: 1155.72,
      priceUpdatedAt: UPDATED_AT,
    });

    expect(asset.cataloguePrice).toBe(1155.72);
    expect(asset.cataloguePriceUpdatedAt).toBe(UPDATED_AT);
  });

  it("keeps USDC in the liquid set so a real pair can win", () => {
    expect(LIQUID_SYMBOLS.has("USDC")).toBe(true);
  });
});
