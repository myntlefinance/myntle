import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../context";

const { getAssetsMock, getLivePricesMock, getBalancesMock } = vi.hoisted(() => ({
  getAssetsMock: vi.fn(),
  getLivePricesMock: vi.fn(),
  getBalancesMock: vi.fn(),
}));

vi.mock("@/lib/intents/service", () => ({
  getAssets: getAssetsMock,
}));

vi.mock("@/lib/prices/server", () => ({
  getLivePrices: getLivePricesMock,
}));

vi.mock("@/lib/wallet/balances", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/wallet/balances")>();
  return { ...actual, getConnectedWalletBalances: getBalancesMock };
});

import { createSupportedAssetsTool } from "./catalogue";

type AssetOutput = {
  assetId: string;
  symbol: string;
  priceUsd?: number;
  priceAsOf?: number;
};

async function run(
  input: Record<string, unknown> = {},
  context?: ToolContext,
) {
  const catalogue = createSupportedAssetsTool(context);
  const result = await catalogue.execute!(
    { ...input },
    { toolCallId: "call-assets", messages: [], context: {} },
  );
  return result as { assets: AssetOutput[] };
}

function asset(index: number) {
  return {
    assetId: `nep141:asset-${index}`,
    symbol: `A${index}`,
    decimals: 6,
    chain: "near",
    price: 1 + index,
    priceUpdatedAt: 1_762_760_000_000 + index,
    contractAddress: `asset-${index}.near`,
  };
}

beforeEach(() => {
  getAssetsMock.mockReset();
  getLivePricesMock.mockReset();
  getBalancesMock.mockReset();
  getLivePricesMock.mockResolvedValue(new Map());
  getBalancesMock.mockResolvedValue({
    address: "0xabc",
    chain: "evm",
    balances: [],
    totalValueUsd: 0,
  });
});

describe("get_supported_assets pricing", () => {
  it("overrides a catalogue price with a live quote", async () => {
    getAssetsMock.mockResolvedValue([asset(0), asset(1)]);
    getLivePricesMock.mockResolvedValue(
      new Map([
        [
          "nep141:asset-0",
          { usd: 2.5, asOf: 1_762_800_000_000, source: "binance", stale: false },
        ],
      ]),
    );

    const result = await run();

    expect(getLivePricesMock).toHaveBeenCalledWith([
      "nep141:asset-0",
      "nep141:asset-1",
    ]);
    expect(result.assets[0]).toMatchObject({
      assetId: "nep141:asset-0",
      priceUsd: 2.5,
      priceAsOf: 1_762_800_000_000,
    });
  });

  it("keeps the catalogue price when the Worker has no quote", async () => {
    getAssetsMock.mockResolvedValue([asset(0), asset(1)]);

    const result = await run();

    expect(result.assets[0]).toMatchObject({
      priceUsd: 1,
      priceAsOf: 1_762_760_000_000,
    });
    expect(result.assets[1]).toMatchObject({
      priceUsd: 2,
      priceAsOf: 1_762_760_000_001,
    });
  });

  it("asks the live feed for no more than the first 60 rows", async () => {
    getAssetsMock.mockResolvedValue(
      Array.from({ length: 61 }, (_, index) => asset(index)),
    );

    const result = await run();

    const asked = getLivePricesMock.mock.calls[0][0] as string[];
    expect(asked).toHaveLength(60);
    expect(asked).not.toContain("nep141:asset-60");
    expect(result.assets).toHaveLength(60);
  });
});

describe("get_supported_assets heldOnly", () => {
  it("maps a native NEAR holding to the catalogue wNEAR row", async () => {
    getAssetsMock.mockResolvedValue([
      {
        assetId: "nep141:wrap.near",
        symbol: "wNEAR",
        decimals: 24,
        chain: "near",
        price: 3,
        priceUpdatedAt: 1_762_760_000_000,
        contractAddress: "wrap.near",
      },
      {
        assetId: "nep141:bsc-native-near",
        symbol: "NEAR",
        decimals: 18,
        chain: "bsc",
        price: 3,
        priceUpdatedAt: 1_762_760_060_000,
        contractAddress: "0xbsc-near",
      },
    ]);
    // No assetId: the alias, not the balance layer, has to find wNEAR.
    getBalancesMock.mockResolvedValue({
      address: "alice.near",
      chain: "near",
      balances: [
        {
          chain: "near",
          network: "near",
          symbol: "NEAR",
          name: "NEAR",
          contractAddress: null,
          decimals: 24,
          balance: "10",
          rawBalance: "10000000000000000000000000",
        },
      ],
      totalValueUsd: 30,
    });

    const result = await run(
      { heldOnly: true },
      { activeAddress: "alice.near", activeChain: "near" },
    );

    expect(result.assets.map((entry) => entry.assetId)).toEqual([
      "nep141:wrap.near",
    ]);
  });

  it("matches a NEAR query to the native wNEAR row", async () => {
    getAssetsMock.mockResolvedValue([
      {
        assetId: "nep141:wrap.near",
        symbol: "wNEAR",
        decimals: 24,
        chain: "near",
        price: 3,
        priceUpdatedAt: 1_762_760_000_000,
        contractAddress: "wrap.near",
      },
      {
        assetId: "nep141:bsc-native-near",
        symbol: "NEAR",
        decimals: 18,
        chain: "bsc",
        price: 3,
        priceUpdatedAt: 1_762_760_060_000,
        contractAddress: "0xbsc-near",
      },
    ]);

    const result = await run({ symbol: "NEAR" });

    expect(result.assets.map((entry) => entry.assetId)).toEqual([
      "nep141:wrap.near",
      "nep141:bsc-native-near",
    ]);
  });

  it("matches a shared contract by contract and chain", async () => {
    const weth = "0x4200000000000000000000000000000000000006";
    getAssetsMock.mockResolvedValue([
      {
        assetId: "nep141:base-0x4200",
        symbol: "WETH",
        decimals: 18,
        chain: "base",
        price: 2000,
        priceUpdatedAt: 1_762_760_000_000,
        contractAddress: weth,
      },
      {
        assetId: "nep141:op-0x4200",
        symbol: "WETH",
        decimals: 18,
        chain: "op",
        price: 2000,
        priceUpdatedAt: 1_762_760_060_000,
        contractAddress: weth,
      },
    ]);
    getBalancesMock.mockResolvedValue({
      address: "0xabc",
      chain: "evm",
      balances: [
        {
          chain: "base",
          network: "base",
          symbol: "WETH",
          name: "Wrapped Ether",
          contractAddress: weth,
          decimals: 18,
          balance: "1",
          rawBalance: "1000000000000000000",
        },
      ],
      totalValueUsd: 2000,
    });

    const result = await run(
      { heldOnly: true, symbol: "WETH" },
      { activeAddress: "0xabc", activeChain: "evm" },
    );

    expect(result.assets.map((entry) => entry.assetId)).toEqual([
      "nep141:base-0x4200",
    ]);
  });
});
