import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import {
  clearPortfolioCache,
  portfolioScope,
  readPortfolioCache,
  writePortfolioCache,
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
});
