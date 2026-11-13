import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  formatTokenAmount,
  classifyAssetCategory,
  groupBalancesByNetwork,
  isPhishingToken,
  networkDisplayName,
  type TokenBalance,
} from "./balances";

const { getAssetsMock, getBalancesMock } = vi.hoisted(() => ({
  getAssetsMock: vi.fn(),
  getBalancesMock: vi.fn(),
}));

vi.mock("@/lib/intents/service", () => ({
  getAssets: getAssetsMock,
}));

vi.mock("@/lib/adapters/registry", () => ({
  getBalancesPort: () => ({ getBalances: getBalancesMock }),
}));

beforeEach(() => {
  getAssetsMock.mockReset();
  getBalancesMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("formatTokenAmount", () => {
  it("formats standard 18 decimal amounts correctly", () => {
    // 1.5 ETH = 1500000000000000000
    const raw = 1500000000000000000n;
    expect(formatTokenAmount(raw, 18)).toBe("1.5");
  });

  it("formats integers without fractional part", () => {
    // 100 USDC (6 decimals) = 100000000
    const raw = 100000000n;
    expect(formatTokenAmount(raw, 6)).toBe("100");
  });

  it("formats small fractional amounts", () => {
    // 0.005 SOL (9 decimals) = 5000000
    const raw = 5000000n;
    expect(formatTokenAmount(raw, 9)).toBe("0.005");
  });

  it("handles zero gracefully", () => {
    expect(formatTokenAmount(0n, 18)).toBe("0");
  });

  it("truncates fractions beyond 6 places for display", () => {
    // 1.123456789 (18 decimals)
    const raw = 1123456789000000000n;
    expect(formatTokenAmount(raw, 18)).toBe("1.123456");
  });
});

describe("classifyAssetCategory", () => {
  it("identifies stablecoins by symbol", () => {
    expect(classifyAssetCategory("USDC", 10)).toBe("stables");
    expect(classifyAssetCategory("USDT", 25)).toBe("stables");
    expect(classifyAssetCategory("USDS", 100)).toBe("stables");
    expect(classifyAssetCategory("DAI", 50)).toBe("stables");
    expect(classifyAssetCategory("AUSD", 12)).toBe("stables");
  });

  it("identifies native / gas tokens", () => {
    expect(classifyAssetCategory("ETH", 3000)).toBe("native");
    expect(classifyAssetCategory("WETH", 3000)).toBe("native");
    expect(classifyAssetCategory("SOL", 150)).toBe("native");
    expect(classifyAssetCategory("NEAR", 5)).toBe("native");
  });

  it("classifies sub-$1 balances as dust", () => {
    expect(classifyAssetCategory("ARB", 0.45)).toBe("dust");
    expect(classifyAssetCategory("OP", 0.02)).toBe("dust");
  });

  it("classifies other standard tokens", () => {
    expect(classifyAssetCategory("ARB", 25.0)).toBe("token");
    expect(classifyAssetCategory("UNI", 15.0)).toBe("token");
  });
});

describe("isPhishingToken", () => {
  it("detects scam and phishing tokens with domain names", () => {
    expect(isPhishingToken("CLAIM-USDC.COM", "Claim USDC")).toBe(true);
    expect(isPhishingToken("ETH", "Visit claim-eth.net to claim")).toBe(true);
    expect(isPhishingToken("AIRDROP.XYZ", "Free Airdrop")).toBe(true);
    expect(isPhishingToken("BONUS", "bonus-tokens.io")).toBe(true);
  });

  it("detects tokens with explicit URLs or Telegram links", () => {
    expect(isPhishingToken("VOUCHER", "https://claim-airdrop.com")).toBe(true);
    expect(isPhishingToken("FREE", "www.airdrop-eth.xyz")).toBe(true);
    expect(isPhishingToken("REWARD", "t.me/free_claim_bot")).toBe(true);
  });

  it("detects phishing action lure phrases", () => {
    expect(isPhishingToken("VOUCHER", "Claim 5000 USDT Free")).toBe(true);
    expect(isPhishingToken("REWARD", "Airdrop Voucher Official")).toBe(true);
    expect(isPhishingToken("BONUS", "Redeem Voucher Now")).toBe(true);
  });

  it("does NOT falsely flag legitimate tokens or bridged assets", () => {
    expect(isPhishingToken("ETH", "Ethereum")).toBe(false);
    expect(isPhishingToken("USDC", "USD Coin")).toBe(false);
    expect(isPhishingToken("USDC.e", "USD Coin (Bridged)")).toBe(false);
    expect(isPhishingToken("USDT.e", "Tether USD")).toBe(false);
    expect(isPhishingToken("wNEAR", "Wrapped NEAR")).toBe(false);
    expect(isPhishingToken("SOL", "Solana")).toBe(false);
    expect(isPhishingToken("PEPE", "Pepe")).toBe(false);
    expect(isPhishingToken("AUSD", "Agora USD")).toBe(false);
  });
});

describe("groupBalancesByNetwork", () => {
  it("groups flat balances by network and sets appropriate icons", () => {
    const balances: TokenBalance[] = [
      {
        chain: "evm",
        network: "arb-mainnet",
        symbol: "USDC",
        name: "USD Coin",
        contractAddress: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
        decimals: 6,
        balance: "50",
        rawBalance: "50000000",
        priceUsd: 1.0,
        valueUsd: 50.0,
        category: "stables",
      },
      {
        chain: "evm",
        network: "eth-mainnet",
        symbol: "ETH",
        name: "Ethereum",
        contractAddress: null,
        decimals: 18,
        balance: "1.2",
        rawBalance: "1200000000000000000",
        priceUsd: 3000.0,
        valueUsd: 3600.0,
        category: "native",
      },
      {
        chain: "evm",
        network: "arb-mainnet",
        symbol: "ARB",
        name: "Arbitrum",
        contractAddress: "0x912ce59144191c1204e64559fe8253a0e49e6548",
        decimals: 18,
        balance: "100",
        rawBalance: "100000000000000000000",
        priceUsd: 0.6,
        valueUsd: 60.0,
        category: "token",
      },
    ];

    const groups = groupBalancesByNetwork(balances);

    expect(groups.length).toBe(2);

    const arbGroup = groups.find((g) => g.name === "Arbitrum");
    expect(arbGroup).toBeDefined();
    expect(arbGroup?.icon).toBe("arb");
    expect(arbGroup?.items.length).toBe(2);

    const ethGroup = groups.find((g) => g.name === "Ethereum");
    expect(ethGroup).toBeDefined();
    expect(ethGroup?.icon).toBe("eth");
    expect(ethGroup?.items.length).toBe(1);
  });

  it("filters out phishing lure tokens from groups", () => {
    const balances: TokenBalance[] = [
      {
        chain: "evm",
        network: "arb-mainnet",
        symbol: "CLAIM-USDC.COM",
        name: "Claim Free 10,000 USDC",
        contractAddress: "0x1111111111111111111111111111111111111111",
        decimals: 6,
        balance: "10000",
        rawBalance: "10000000000",
        priceUsd: 1.0,
        valueUsd: 10000.0,
        category: "token",
      },
      {
        chain: "evm",
        network: "arb-mainnet",
        symbol: "USDC",
        name: "USD Coin",
        contractAddress: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
        decimals: 6,
        balance: "50",
        rawBalance: "50000000",
        priceUsd: 1.0,
        valueUsd: 50.0,
        category: "stables",
      },
    ];

    const groups = groupBalancesByNetwork(balances);
    expect(groups.length).toBe(1);
    expect(groups[0].items.length).toBe(1);
    expect(groups[0].items[0].symbol).toBe("USDC");
  });
});

describe("getConnectedWalletBalances network filtering", () => {
  it("short-circuits NEAR requests when filtered to non-NEAR networks", async () => {
    const { getConnectedWalletBalances } = await import("./balances");
    const res = await getConnectedWalletBalances("near", "test.near", {
      networks: ["arbitrum", "base"],
    });
    expect(res.balances).toEqual([]);
    expect(res.totalValueUsd).toBe(0);
  });
});

describe("getConnectedWalletBalances catalogue enrichment", () => {
  const ARB_USDC = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
  const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

  const catalogue = [
    {
      assetId: "nep141:arb-0xaf88",
      symbol: "USDC",
      decimals: 6,
      chain: "arb",
      price: 1,
      priceUpdatedAt: 1_762_760_000_000,
      contractAddress: ARB_USDC,
    },
    {
      assetId: "nep141:base-0x8335",
      symbol: "USDC",
      decimals: 6,
      chain: "base",
      price: 1,
      priceUpdatedAt: 1_762_760_060_000,
      contractAddress: BASE_USDC,
    },
    {
      assetId: "nep141:eth.omft.near",
      symbol: "ETH",
      decimals: 18,
      chain: "eth",
      price: 2000,
      priceUpdatedAt: 1_762_760_120_000,
      contractAddress: null,
    },
    {
      assetId: "nep141:sol.omft.near",
      symbol: "SOL",
      decimals: 9,
      chain: "sol",
      price: 80,
      priceUpdatedAt: 1_762_760_180_000,
      contractAddress: null,
    },
    {
      assetId: "nep141:base-0x4200",
      symbol: "WETH",
      decimals: 18,
      chain: "base",
      price: 2000,
      priceUpdatedAt: 1_762_760_240_000,
      contractAddress: "0x4200000000000000000000000000000000000006",
    },
    {
      assetId: "nep141:op-0x4200",
      symbol: "WETH",
      decimals: 18,
      chain: "op",
      price: 2000,
      priceUpdatedAt: 1_762_760_300_000,
      contractAddress: "0x4200000000000000000000000000000000000006",
    },
    {
      assetId: "nep141:wrap.near",
      symbol: "wNEAR",
      decimals: 24,
      chain: "near",
      price: 3,
      priceUpdatedAt: 1_762_760_360_000,
      contractAddress: "wrap.near",
    },
  ];

  function balance(overrides: Partial<TokenBalance> = {}): TokenBalance {
    return {
      chain: "base",
      network: "base",
      symbol: "USDC",
      name: "USD Coin",
      contractAddress: BASE_USDC,
      decimals: 6,
      balance: "5.2",
      rawBalance: "5200000",
      priceUsd: 1,
      valueUsd: 5.2,
      ...overrides,
    };
  }

  beforeEach(() => {
    getAssetsMock.mockResolvedValue(catalogue);
    getBalancesMock.mockImplementation(async (_chain, address) => ({
      address,
      chain: "evm",
      balances: [balance()],
      totalValueUsd: 5.2,
    }));
  });

  it("matches a contract on the row's own chain", async () => {
    const { getConnectedWalletBalances } = await import("./balances");
    getBalancesMock.mockResolvedValue({
      address: "0xabc",
      chain: "evm",
      balances: [balance({ network: "base", chain: "base" })],
      totalValueUsd: 5.2,
    });

    const res = await getConnectedWalletBalances("evm", "0xabc");

    expect(res.balances[0]).toMatchObject({
      assetId: "nep141:base-0x8335",
      quantity: 5.2,
      priceAsOf: 1_762_760_060_000,
    });
  });

  it("does not borrow a unique contract from another chain", async () => {
    const { getConnectedWalletBalances } = await import("./balances");
    // The contract is Base's USDC, but the row says Arbitrum. The catalogue
    // has an Arbitrum USDC with a different contract, so neither a bare
    // contract match nor the ticker may stand in for it.
    getBalancesMock.mockResolvedValue({
      address: "0xabc",
      chain: "evm",
      balances: [balance({ network: "arb", chain: "arb" })],
      totalValueUsd: 5.2,
    });

    const res = await getConnectedWalletBalances("evm", "0xabc");

    expect(res.balances[0].quantity).toBe(5.2);
    expect("assetId" in res.balances[0]).toBe(false);
    expect("priceAsOf" in res.balances[0]).toBe(false);
  });

  it("resolves a contract shared by two chains to the row's own chain", async () => {
    const { getConnectedWalletBalances } = await import("./balances");
    getBalancesMock.mockResolvedValue({
      address: "0xabc",
      chain: "evm",
      balances: [
        balance({
          symbol: "WETH",
          name: "Wrapped Ether",
          contractAddress: "0x4200000000000000000000000000000000000006",
          network: "opt",
          chain: "opt",
          decimals: 18,
          balance: "1",
          rawBalance: "1000000000000000000",
          valueUsd: 2000,
        }),
      ],
      totalValueUsd: 2000,
    });

    const res = await getConnectedWalletBalances("evm", "0xabc");

    expect(res.balances[0]).toMatchObject({
      assetId: "nep141:op-0x4200",
      priceAsOf: 1_762_760_300_000,
    });
  });

  it("never prices a contract token as the native token with the same ticker", async () => {
    const { getConnectedWalletBalances } = await import("./balances");
    getBalancesMock.mockResolvedValue({
      address: "0xabc",
      chain: "evm",
      balances: [
        balance({
          symbol: "ETH",
          name: "Fake ETH",
          contractAddress: "0x1111faa909c7b18dbdc4328f077fc8a3f207e6e5",
          network: "ethereum",
          chain: "ethereum",
          decimals: 18,
          balance: "1000",
          rawBalance: "1000000000000000000000",
          valueUsd: 0,
        }),
      ],
      totalValueUsd: 0,
    });

    const res = await getConnectedWalletBalances("evm", "0xabc");

    expect(res.balances[0].quantity).toBe(1000);
    expect("assetId" in res.balances[0]).toBe(false);
    expect("priceAsOf" in res.balances[0]).toBe(false);
  });

  it("falls back to the symbol and an aliased chain for a native token", async () => {
    const { getConnectedWalletBalances } = await import("./balances");
    getBalancesMock.mockResolvedValue({
      address: "0xabc",
      chain: "evm",
      balances: [
        balance({
          symbol: "ETH",
          name: "Ethereum",
          contractAddress: null,
          network: "ethereum",
          chain: "ethereum",
          decimals: 18,
          balance: "1.5",
          rawBalance: "1500000000000000000",
          valueUsd: 3000,
        }),
      ],
      totalValueUsd: 3000,
    });

    const res = await getConnectedWalletBalances("evm", "0xabc");

    expect(res.balances[0]).toMatchObject({
      assetId: "nep141:eth.omft.near",
      quantity: 1.5,
      priceAsOf: 1_762_760_120_000,
    });
  });

  it("maps solana to the catalogue's sol chain", async () => {
    const { getConnectedWalletBalances } = await import("./balances");
    getBalancesMock.mockResolvedValue({
      address: "So1ana",
      chain: "solana",
      balances: [
        balance({
          symbol: "SOL",
          name: "Solana",
          contractAddress: null,
          network: "solana",
          chain: "solana",
          decimals: 9,
          balance: "12.5",
          rawBalance: "12500000000",
          valueUsd: 1000,
        }),
      ],
      totalValueUsd: 1000,
    });

    const res = await getConnectedWalletBalances("solana", "So1ana");

    expect(res.balances[0]).toMatchObject({
      assetId: "nep141:sol.omft.near",
      quantity: 12.5,
    });
  });

  it("derives quantity from the formatted balance, commas included", async () => {
    const { getConnectedWalletBalances } = await import("./balances");
    getBalancesMock.mockResolvedValue({
      address: "0xabc",
      chain: "evm",
      balances: [balance({ balance: "1,250.5", rawBalance: "1250500000" })],
      totalValueUsd: 1250.5,
    });

    const res = await getConnectedWalletBalances("evm", "0xabc");

    expect(res.balances[0].quantity).toBe(1250.5);
  });

  it("falls back to rawBalance over decimals when the display string fails", async () => {
    const { getConnectedWalletBalances } = await import("./balances");
    getBalancesMock.mockResolvedValue({
      address: "0xabc",
      chain: "evm",
      balances: [balance({ balance: "n/a", rawBalance: "1500000" })],
      totalValueUsd: 1.5,
    });

    const res = await getConnectedWalletBalances("evm", "0xabc");

    expect(res.balances[0].quantity).toBe(1.5);
  });

  it("adds no undefined keys when a row has no catalogue match", async () => {
    const { getConnectedWalletBalances } = await import("./balances");
    getBalancesMock.mockResolvedValue({
      address: "0xabc",
      chain: "evm",
      balances: [
        balance({
          symbol: "MYSTERY",
          name: "Mystery Token",
          contractAddress: "0xdead",
          balance: "7",
          rawBalance: "7000000",
        }),
      ],
      totalValueUsd: 7,
    });

    const res = await getConnectedWalletBalances("evm", "0xabc");

    expect(res.balances[0].quantity).toBe(7);
    expect("assetId" in res.balances[0]).toBe(false);
    expect("priceAsOf" in res.balances[0]).toBe(false);
    expect(Object.values(res.balances[0])).not.toContain(undefined);
  });

  it("maps native NEAR to the wrapped NEAR asset", async () => {
    const { getConnectedWalletBalances } = await import("./balances");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          params?: { request_type?: string };
        };
        if (body.params?.request_type === "view_account") {
          return {
            ok: true,
            json: async () => ({
              result: { amount: "10000000000000000000000000" },
            }),
          } as Response;
        }
        return { ok: false, json: async () => ({}) } as Response;
      }),
    );

    const res = await getConnectedWalletBalances("near", "alice.near");

    expect(res.balances[0]).toMatchObject({
      symbol: "NEAR",
      assetId: "nep141:wrap.near",
      quantity: 10,
      priceAsOf: 1_762_760_360_000,
      priceUsd: 3,
      valueUsd: 30,
    });
  });

  it("keeps the balances when the catalogue is unavailable", async () => {
    const { getConnectedWalletBalances } = await import("./balances");
    getAssetsMock.mockRejectedValue(new Error("catalogue down"));

    const res = await getConnectedWalletBalances("evm", "0xabc");

    expect(res.balances).toHaveLength(1);
    expect(res.balances[0]).toMatchObject({ symbol: "USDC", valueUsd: 5.2 });
  });
});

describe("networkDisplayName", () => {
  it("names known chain ids", () => {
    expect(networkDisplayName("arb")).toBe("Arbitrum");
    expect(networkDisplayName("eth")).toBe("Ethereum");
    expect(networkDisplayName("near")).toBe("NEAR");
  });

  it("names the slugs Alchemy answers with", () => {
    expect(networkDisplayName("solana-mainnet")).toBe("Solana");
    // Alchemy takes polygon-mainnet on the request and answers matic-mainnet.
    expect(networkDisplayName("matic-mainnet")).toBe("Polygon");
    expect(networkDisplayName("matic")).toBe("Polygon");
  });

  it("falls back to the raw id when unknown", () => {
    expect(networkDisplayName("mychain")).toBe("mychain");
    expect(networkDisplayName(undefined)).toBe("");
  });
});
