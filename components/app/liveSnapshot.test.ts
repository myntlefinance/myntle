import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssetItem } from "@/lib/wallet/balances";
import type { PortfolioSnapshot } from "./portfolioCache";
import type { LiveQuote } from "./priceStore";
import {
  applyLivePrices,
  chainCandidates,
  resolveItemAsset,
  resolveItemAssetId,
  snapshotSeeds,
  unresolvedSymbols,
} from "./liveSnapshot";

const ETH_ID = "nep141:base-0xeth";
const NEAR_ID = "nep141:wrap.near";

function quote(assetId: string, usd: number): LiveQuote {
  return {
    assetId,
    usd,
    asOf: Date.now(),
    source: "binance",
    stale: false,
  };
}

function item(overrides: Partial<AssetItem> = {}): AssetItem {
  return {
    id: "eth",
    symbol: "ETH",
    name: "Ether",
    amount: "1.0",
    valueUsd: 2000,
    priceUsd: 2000,
    category: "native",
    chain: "base",
    network: "base",
    ...overrides,
  };
}

function snapshot(): PortfolioSnapshot {
  const eth = item();
  const near = item({
    id: "near",
    symbol: "NEAR",
    name: "NEAR",
    amount: "100",
    valueUsd: 300,
    priceUsd: 3,
    chain: "near",
    network: "near",
  });
  return {
    groups: [
      { id: "base", name: "Base", icon: "base", items: [eth] },
      { id: "near", name: "NEAR", icon: "near", items: [near] },
    ],
    totalUsd: 2300,
    walletGroups: [{ id: "base", name: "Base", icon: "base", items: [eth] }],
    superGroups: [{ id: "near", name: "NEAR", icon: "near", items: [near] }],
    walletUsd: 2000,
    superUsd: 300,
  };
}

function resolveByChain(value: AssetItem): string | undefined {
  return value.chain === "base" ? ETH_ID : NEAR_ID;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("applyLivePrices", () => {
  it("returns the settled snapshot untouched when the rollout flag is off", () => {
    const original = snapshot();
    const quotes = new Map([
      [ETH_ID, quote(ETH_ID, 2500)],
      [NEAR_ID, quote(NEAR_ID, 4)],
    ]);
    vi.stubEnv("NEXT_PUBLIC_PRICES_LIVE", "0");

    // Same reference, not just equal: the portfolio must not re-render on a
    // price the disabled feed was never allowed to read.
    expect(applyLivePrices(original, quotes, resolveByChain)).toBe(original);
  });

  it("updates the unit price, the row value, and every total", () => {
    const original = snapshot();
    const quotes = new Map([
      [ETH_ID, quote(ETH_ID, 2500)],
      [NEAR_ID, quote(NEAR_ID, 4)],
    ]);

    const next = applyLivePrices(original, quotes, resolveByChain);

    expect(next).not.toBe(original);
    expect(next.groups[0].items[0].priceUsd).toBe(2500);
    expect(next.groups[0].items[0].valueUsd).toBe(2500);
    expect(next.groups[1].items[0].priceUsd).toBe(4);
    expect(next.groups[1].items[0].valueUsd).toBe(400);
    expect(next.walletUsd).toBe(2500);
    expect(next.superUsd).toBe(400);
    expect(next.totalUsd).toBe(2900);
  });

  it("keeps the group copies consistent with the updated rows", () => {
    const original = snapshot();
    const quotes = new Map([[ETH_ID, quote(ETH_ID, 2500)]]);

    const next = applyLivePrices(original, quotes, resolveByChain);

    expect(next.walletGroups?.[0].items[0].valueUsd).toBe(2500);
    expect(next.superGroups?.[0].items[0].valueUsd).toBe(300);
    expect(next.groups[0].items[0].valueUsd).toBe(2500);
  });

  it("falls back to the amount when a row has no unit price", () => {
    const original = snapshot();
    original.groups[0].items[0] = item({
      id: "usdc",
      symbol: "USDC",
      amount: "1,250.50",
      valueUsd: 0,
      priceUsd: undefined,
    });
    const quotes = new Map([["nep141:usdc", quote("nep141:usdc", 2)]]);

    const next = applyLivePrices(original, quotes, () => "nep141:usdc");

    expect(next.groups[0].items[0].priceUsd).toBe(2);
    expect(next.groups[0].items[0].valueUsd).toBe(2501);
  });

  it("returns the same snapshot when nothing changed", () => {
    const original = snapshot();
    const quotes = new Map([
      [ETH_ID, quote(ETH_ID, 2000)],
      [NEAR_ID, quote(NEAR_ID, 3)],
    ]);

    expect(applyLivePrices(original, quotes, resolveByChain)).toBe(original);
  });

  it("returns the same snapshot when no quote matches", () => {
    const original = snapshot();
    const quotes = new Map([["unknown", quote("unknown", 1)]]);

    expect(applyLivePrices(original, quotes, resolveByChain)).toBe(original);
    expect(applyLivePrices(original, new Map(), resolveByChain)).toBe(original);
  });

  it("honours an assetId already on the row", () => {
    const original = snapshot();
    const withId = {
      ...item({ id: "eth" }),
      assetId: ETH_ID,
    } as AssetItem;
    original.groups[0].items[0] = withId;

    const next = applyLivePrices(
      original,
      new Map([[ETH_ID, quote(ETH_ID, 2100)]]),
    );

    expect(next.groups[0].items[0].valueUsd).toBe(2100);
  });

  it("uses the exact quantity instead of scaling the stored value", () => {
    const original = snapshot();
    original.groups[0].items[0] = item({
      id: "eth",
      quantity: 2.5,
      amount: "2.5",
      valueUsd: 4800,
      priceUsd: 2000,
    });

    const next = applyLivePrices(
      original,
      new Map([[ETH_ID, quote(ETH_ID, 2100)]]),
      () => ETH_ID,
    );

    // 2.5 × 2100. The stored value is deliberately inconsistent with the
    // stored unit price, so the ratio path would give 5040 instead.
    expect(next.groups[0].items[0].valueUsd).toBe(5250);
    expect(next.groups[0].items[0].priceUsd).toBe(2100);
  });

  it("keeps the prior value when the computed value is not finite", () => {
    const original = snapshot();
    original.groups[0].items[0] = item({
      id: "tiny",
      priceUsd: 1e-300,
      valueUsd: 1,
    });
    const quotes = new Map([
      [ETH_ID, { ...quote(ETH_ID, 1e300), usd: 1e300 }],
    ]);

    const next = applyLivePrices(original, quotes, () => ETH_ID);

    expect(next.groups[0].items[0].priceUsd).toBe(1e300);
    expect(next.groups[0].items[0].valueUsd).toBe(1);
    expect(Number.isFinite(next.totalUsd)).toBe(true);
  });

  it("leaves a row with a non-finite prior value untouched", () => {
    const original: PortfolioSnapshot = {
      groups: [
        {
          id: "base",
          name: "Base",
          icon: "base",
          items: [item({ id: "broken", valueUsd: Number.POSITIVE_INFINITY })],
        },
      ],
      totalUsd: 1,
    };

    const next = applyLivePrices(
      original,
      new Map([[ETH_ID, quote(ETH_ID, 2500)]]),
      () => ETH_ID,
    );

    expect(next).toBe(original);
    expect(next.groups[0].items[0].valueUsd).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it("ignores a non-finite quote instead of poisoning the row", () => {
    const original = snapshot();
    const quotes = new Map([
      [ETH_ID, { ...quote(ETH_ID, 1), usd: Number.NaN }],
    ]);

    expect(applyLivePrices(original, quotes, resolveByChain)).toBe(original);
  });
});

describe("resolveItemAssetId", () => {
  const rows = [
    {
      assetId: "nep141:eth-0xabc",
      symbol: "USDC",
      chain: "eth",
      priceUsd: 1,
      contractAddress: "0xabc",
    },
    {
      assetId: "nep141:base-0xdef",
      symbol: "USDC",
      chain: "base",
      priceUsd: 1.01,
      contractAddress: "0xdef",
    },
    {
      assetId: "nep141:usdc.near",
      symbol: "USDC",
      chain: "near",
      priceUsd: 1,
      contractAddress: "usdc.near",
    },
  ];
  const lookup = (symbol: string) =>
    symbol === "USDC" ? rows : [];

  it("uses a contract that is already an asset id", () => {
    const value = item({
      id: "ledger",
      symbol: "USDC",
      contractAddress: "nep141:usdc.near",
      chain: "near",
    });
    expect(resolveItemAssetId(value, lookup)).toBe("nep141:usdc.near");
  });

  it("prefers an assetId already on the row over the lookup", () => {
    const value = {
      ...item({
        id: "explicit",
        symbol: "USDC",
        contractAddress: "0xdef",
        chain: "base",
      }),
      assetId: "nep141:explicit",
    } as AssetItem;

    expect(resolveItemAssetId(value, lookup)).toBe("nep141:explicit");
  });

  it("matches a contract on the item's own chain", () => {
    const value = item({
      id: "usdc-base",
      symbol: "USDC",
      contractAddress: "0xdef",
      chain: "base",
    });
    expect(resolveItemAssetId(value, lookup)).toBe("nep141:base-0xdef");
  });

  it("does not borrow a contract from another chain", () => {
    // The contract is Base's USDC, but the row says Ethereum. The catalogue
    // has a USDC on Ethereum too; a ticker match must not stand in for the
    // contract match.
    const value = item({
      id: "usdc-base-on-eth",
      symbol: "USDC",
      contractAddress: "0xdef",
      chain: "eth",
    });
    expect(resolveItemAssetId(value, lookup)).toBeUndefined();
  });

  it("accepts a unique bare contract only when the chain is unknown", () => {
    const value = item({
      id: "usdc-unknown-chain",
      symbol: "USDC",
      contractAddress: "0xabc",
      chain: undefined,
      network: undefined,
    });
    expect(resolveItemAssetId(value, lookup)).toBe("nep141:eth-0xabc");
  });

  it("resolves the shared WETH predeploy by the row's chain", () => {
    const weth = "0x4200000000000000000000000000000000000006";
    const wethRows = [
      {
        assetId: "nep141:base-0x4200",
        symbol: "WETH",
        chain: "base",
        priceUsd: 2000,
        contractAddress: weth,
      },
      {
        assetId: "nep141:op-0x4200",
        symbol: "WETH",
        chain: "op",
        priceUsd: 2000,
        contractAddress: weth,
      },
    ];
    const wethLookup = (symbol: string) =>
      symbol === "WETH" ? wethRows : [];

    const onBase = item({
      id: "weth-base",
      symbol: "WETH",
      contractAddress: weth,
      chain: "base",
    });
    const onOptimism = item({
      id: "weth-op",
      symbol: "WETH",
      contractAddress: weth,
      chain: "optimism",
    });

    expect(resolveItemAssetId(onBase, wethLookup)).toBe(
      "nep141:base-0x4200",
    );
    expect(resolveItemAssetId(onOptimism, wethLookup)).toBe(
      "nep141:op-0x4200",
    );
  });

  it("rejects an ambiguous bare contract when the chain is unknown", () => {
    const weth = "0x4200000000000000000000000000000000000006";
    const wethLookup = () => [
      {
        assetId: "nep141:base-0x4200",
        symbol: "WETH",
        chain: "base",
        contractAddress: weth,
      },
      {
        assetId: "nep141:op-0x4200",
        symbol: "WETH",
        chain: "op",
        contractAddress: weth,
      },
    ];
    const value = item({
      id: "weth-unknown",
      symbol: "WETH",
      contractAddress: weth,
      chain: undefined,
      network: undefined,
    });

    expect(resolveItemAssetId(value, wethLookup)).toBeUndefined();
  });

  it("leaves a fake same-ticker contract token unpriced", () => {
    const nativeEth = {
      assetId: "nep141:eth.omft.near",
      symbol: "ETH",
      chain: "eth",
      priceUsd: 2000,
      contractAddress: null,
    };
    const ethLookup = (symbol: string) => (symbol === "ETH" ? [nativeEth] : []);
    const fake = item({
      id: "fake-eth",
      symbol: "ETH",
      name: "Fake ETH",
      contractAddress: "0x1111faa909c7b18dbdc4328f077fc8a3f207e6e5",
      chain: "eth",
      valueUsd: 12,
      priceUsd: undefined,
    });

    // No resolved id means no subscription and no seed for this row.
    expect(resolveItemAssetId(fake, ethLookup)).toBeUndefined();

    const original: PortfolioSnapshot = {
      groups: [{ id: "eth", name: "Ethereum", icon: "eth", items: [fake] }],
      totalUsd: 12,
    };
    const next = applyLivePrices(
      original,
      new Map([["nep141:eth.omft.near", quote("nep141:eth.omft.near", 2500)]]),
      (value) => resolveItemAssetId(value, ethLookup),
    );

    expect(next).toBe(original);
    expect(next.groups[0].items[0].valueUsd).toBe(12);
  });

  it("matches chain spellings across the wallet and the catalogue", () => {
    const value = item({
      id: "usdc-eth",
      symbol: "USDC",
      contractAddress: null,
      chain: "ethereum",
    });
    expect(resolveItemAssetId(value, lookup)).toBe("nep141:eth-0xabc");
  });

  it("does not borrow another chain's price", () => {
    const value = item({
      id: "usdc-sol",
      symbol: "USDC",
      contractAddress: null,
      chain: "solana",
    });
    expect(resolveItemAssetId(value, lookup)).toBeUndefined();
  });

  it("treats intents as the NEAR balance it settles on", () => {
    const value = item({
      id: "intents",
      symbol: "USDC",
      contractAddress: null,
      chain: "near",
      network: "intents",
    });
    expect(resolveItemAssetId(value, lookup)).toBe("nep141:usdc.near");
    expect(chainCandidates("intents")).toContain("near");
  });

  it("carries the catalogue's observation time", () => {
    const rows = [
      {
        assetId: "nep141:base-0xdef",
        symbol: "USDC",
        chain: "base",
        priceUsd: 1.01,
        priceAsOf: 1_762_760_000_000,
        contractAddress: "0xdef",
      },
    ];
    const value = item({
      id: "usdc-base",
      symbol: "USDC",
      contractAddress: "0xdef",
      chain: "base",
    });

    expect(resolveItemAsset(value, () => rows)).toEqual({
      assetId: "nep141:base-0xdef",
      priceAsOf: 1_762_760_000_000,
    });
  });
});

describe("unresolvedSymbols", () => {
  it("skips a row with an assetId even when priceAsOf is absent", () => {
    const items = [
      item({ id: "a", symbol: "ETH", assetId: "nep141:eth.omft.near" }),
      item({ id: "b", symbol: "USDC" }),
      item({ id: "c", symbol: "usdc" }),
    ];

    expect(unresolvedSymbols(items)).toEqual(["USDC"]);
  });

  it("keeps a contract token that has no assetId", () => {
    const fake = item({
      id: "fake",
      symbol: "ETH",
      contractAddress: "0x1111faa909c7b18dbdc4328f077fc8a3f207e6e5",
    });

    expect(unresolvedSymbols([fake])).toEqual(["ETH"]);
  });
});

describe("snapshotSeeds", () => {
  it("seeds the store with the row's own observation time", () => {
    const value = item({
      id: "eth",
      priceUsd: 2000,
      priceAsOf: 1_762_760_000_000,
    });

    const seeds = snapshotSeeds(
      [value],
      new Map([[value.id, { assetId: ETH_ID, priceAsOf: 1_762_700_000_000 }]]),
    );

    expect(seeds).toEqual([
      { assetId: ETH_ID, usd: 2000, asOf: 1_762_760_000_000 },
    ]);
  });

  it("falls back to the catalogue's observation time", () => {
    const value = item({ id: "eth", priceUsd: 2000 });

    const seeds = snapshotSeeds(
      [value],
      new Map([[value.id, { assetId: ETH_ID, priceAsOf: 1_762_700_000_000 }]]),
    );

    expect(seeds).toEqual([
      { assetId: ETH_ID, usd: 2000, asOf: 1_762_700_000_000 },
    ]);
  });

  it("skips rows without a usable unit price", () => {
    const value = item({ id: "eth", priceUsd: 0 });

    expect(
      snapshotSeeds([value], new Map([[value.id, { assetId: ETH_ID }]])),
    ).toEqual([]);
  });

  it("does not seed a row with no resolved assetId", () => {
    const fake = item({
      id: "fake-eth",
      symbol: "ETH",
      contractAddress: "0x1111faa909c7b18dbdc4328f077fc8a3f207e6e5",
      priceUsd: 2000,
    });

    expect(snapshotSeeds([fake], new Map())).toEqual([]);
  });
});
