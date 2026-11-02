import { describe, it, expect } from "vitest";
import {
  formatTokenAmount,
  classifyAssetCategory,
  groupBalancesByNetwork,
  isPhishingToken,
  networkDisplayName,
  type TokenBalance,
} from "./balances";

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
  it("short-circuits EVM requests when filtered to non-EVM networks", async () => {
    const { getConnectedWalletBalances } = await import("./balances");
    const res = await getConnectedWalletBalances(
      "evm",
      "0x1234567890123456789012345678901234567890",
      {
        networks: ["solana"],
      },
    );
    expect(res.balances).toEqual([]);
    expect(res.totalValueUsd).toBe(0);
  });

  it("short-circuits NEAR requests when filtered to non-NEAR networks", async () => {
    const { getConnectedWalletBalances } = await import("./balances");
    const res = await getConnectedWalletBalances("near", "test.near", {
      networks: ["arbitrum", "base"],
    });
    expect(res.balances).toEqual([]);
    expect(res.totalValueUsd).toBe(0);
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

describe("Alchemy request slugs", () => {
  it("asks for solana-mainnet, which is the only slug the API accepts", async () => {
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.ALCHEMY_API_KEY;
    const bodies: Array<{
      addresses: Array<{ address: string; networks: string[] }>;
    }> = [];

    process.env.ALCHEMY_API_KEY = "test-key";
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ data: { tokens: [] } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const { getConnectedWalletBalances } = await import("./balances");
      await getConnectedWalletBalances(
        "solana",
        "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
      );
      expect(bodies[0]?.addresses[0]?.networks).toEqual(["solana-mainnet"]);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalKey === undefined) delete process.env.ALCHEMY_API_KEY;
      else process.env.ALCHEMY_API_KEY = originalKey;
    }
  });
});
