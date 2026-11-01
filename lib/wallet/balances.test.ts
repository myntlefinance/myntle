import { describe, it, expect } from "vitest";
import {
  formatTokenAmount,
  classifyAssetCategory,
  groupBalancesByNetwork,
  isPhishingToken,
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
