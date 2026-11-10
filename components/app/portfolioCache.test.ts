import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import {
  SAMPLE_PORTFOLIO,
  clearPortfolioCache,
  clearSuperPrivateCache,
  countGroupRows,
  portfolioScope,
  readPortfolioCache,
  readPortfolioRowCount,
  readSuperPrivateCache,
  sampleGroupsWithRows,
  writePortfolioCache,
  writePortfolioRowCount,
  writeSuperPrivateCache,
  type PortfolioSnapshot,
} from "./portfolioCache";

const store = new Map<string, string>();
const mockSessionStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, val: string) => store.set(key, val),
  removeItem: (key: string) => store.delete(key),
  clear: () => store.clear(),
  key: (i: number) => Array.from(store.keys())[i] ?? null,
  get length() {
    return store.size;
  },
};

const snapshot: PortfolioSnapshot = {
  groups: [
    {
      id: "Base",
      name: "Base",
      icon: "base",
      items: [
        {
          id: "usdc",
          symbol: "USDC",
          name: "USD Coin",
          amount: "10.00",
          valueUsd: 10,
          category: "stables",
        },
      ],
    },
  ],
  totalUsd: 10,
};

describe("portfolioCache", () => {
  beforeAll(() => {
    (globalThis as unknown as { sessionStorage: typeof mockSessionStorage }).sessionStorage =
      mockSessionStorage;
  });

  afterAll(() => {
    delete (globalThis as unknown as { sessionStorage?: typeof mockSessionStorage })
      .sessionStorage;
  });

  beforeEach(() => {
    store.clear();
    clearPortfolioCache();
    clearSuperPrivateCache();
  });

  it("keys the same address by its chain", () => {
    expect(portfolioScope("evm", "0xabc")).not.toBe(
      portfolioScope("solana", "0xabc"),
    );
  });

  it("treats an EVM address as one account whatever its casing", () => {
    expect(portfolioScope("evm", "0xAbC")).toBe(portfolioScope("evm", "0xabc"));
  });

  it("round-trips a snapshot through sessionStorage", () => {
    const scope = portfolioScope("base", "0xabc");
    writePortfolioCache(scope, snapshot);

    const restored = readPortfolioCache(scope);
    expect(restored?.totalUsd).toBe(10);
    expect(restored?.groups[0].items[0].symbol).toBe("USDC");
  });

  it("clears stored snapshots", () => {
    const scope = portfolioScope("base", "0xabc");
    writePortfolioCache(scope, snapshot);
    clearPortfolioCache();
    expect(readPortfolioCache(scope)).toBeUndefined();
    expect(store.size).toBe(0);
  });

  it("remembers the last row count per tab and clears it with the account", () => {
    const scope = portfolioScope("evm", "0xabc");
    writePortfolioRowCount(scope, "wallet", 3);
    writePortfolioRowCount(scope, "super", 0);

    expect(readPortfolioRowCount(scope, "wallet")).toBe(3);
    expect(readPortfolioRowCount(scope, "super")).toBe(0);
    expect(readPortfolioRowCount(scope, "watched")).toBeNull();

    clearPortfolioCache();
    expect(readPortfolioRowCount(scope, "wallet")).toBeNull();
    expect(store.size).toBe(0);
  });

  it("pads or trims the sample groups to the remembered row count", () => {
    const groups = SAMPLE_PORTFOLIO.walletGroups ?? [];
    const original = countGroupRows(groups);

    const taller = sampleGroupsWithRows(groups, original + 3);
    expect(countGroupRows(taller)).toBe(original + 3);
    expect(new Set(taller.flatMap((group) => group.items.map((item) => item.id))).size).toBe(
      original + 3,
    );

    const shorter = sampleGroupsWithRows(groups, 2);
    expect(countGroupRows(shorter)).toBe(2);

    expect(sampleGroupsWithRows(groups, 0)).toEqual([]);
    expect(sampleGroupsWithRows(groups, null)).toBe(groups);
  });

  it("samples at least eight holdings so the skeleton reserves a normal portfolio", () => {
    const holdings = SAMPLE_PORTFOLIO.groups.flatMap((group) => group.items);
    const total = holdings.reduce((sum, item) => sum + item.valueUsd, 0);

    expect(holdings.length).toBeGreaterThanOrEqual(8);
    expect(SAMPLE_PORTFOLIO.totalUsd).toBeCloseTo(total, 2);
    expect(SAMPLE_PORTFOLIO.walletUsd).toBeCloseTo(
      SAMPLE_PORTFOLIO.walletGroups?.flatMap((group) => group.items).reduce(
        (sum, item) => sum + item.valueUsd,
        0,
      ) ?? 0,
      2,
    );
    expect(SAMPLE_PORTFOLIO.superUsd).toBeCloseTo(
      SAMPLE_PORTFOLIO.superGroups?.flatMap((group) => group.items).reduce(
        (sum, item) => sum + item.valueUsd,
        0,
      ) ?? 0,
      2,
    );
  });

  it("round-trips a private read through sessionStorage", () => {
    const scope = `super-private:${portfolioScope("evm", "0xabc")}`;
    const read = {
      ok: true as const,
      entries: [{ tokenId: "token-c1", available: "10" }],
    };
    writeSuperPrivateCache(scope, read);

    const restored = readSuperPrivateCache(scope);
    expect(restored).toEqual(read);
  });

  it("never caches a locked read", () => {
    const scope = "super-private:locked-scope";
    writeSuperPrivateCache(scope, { ok: false, reason: "locked" } as const);
    expect(readSuperPrivateCache(scope)).toBeUndefined();
    expect(store.size).toBe(0);
  });

  it("keeps the private cache apart from the wallet cache", () => {
    writeSuperPrivateCache("scope-a", {
      ok: true as const,
      entries: [{ tokenId: "token-c1", available: "10" }],
    });
    expect(readPortfolioCache("scope-a")).toBeUndefined();
    clearSuperPrivateCache();
    expect(readSuperPrivateCache("scope-a")).toBeUndefined();
    expect(store.size).toBe(0);
  });
});
