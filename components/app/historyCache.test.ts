import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import type { InfiniteData } from "@tanstack/react-query";
import {
  clearHistoryCache,
  mergeNewestPage,
  readHistoryCache,
  writeHistoryCache,
  type HistoryPage,
  type HistoryRow,
} from "./historyCache";

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

function row(id: string, state = "settled"): HistoryRow {
  return {
    id,
    state,
    depositAddress: null,
    recipient: null,
    originAsset: "nep141:usdc.near",
    destinationAsset: "nep141:eth.omft.near",
    amountIn: "10.00",
    expectedOut: "0.003",
    amountOut: "0.0031",
    explorerUrls: [],
    conversationId: null,
    createdAt: "2026-11-04T00:00:00.000Z",
  };
}

function page(transactions: HistoryRow[], nextCursor: string | null): HistoryPage {
  return { transactions, nextCursor };
}

describe("historyCache", () => {
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
    clearHistoryCache();
  });

  it("round-trips pages through sessionStorage", () => {
    writeHistoryCache("evm:0xabc", {
      pages: [page([row("a")], "cursor-2"), page([row("b")], null)],
      pageParams: [null, "cursor-2"],
    });

    const restored = readHistoryCache("evm:0xabc");
    expect(restored?.pages[0].transactions[0].id).toBe("a");
    // The session copy outlives a reload, which memory alone does not.
    expect(store.get("myntle-history-v1:evm:0xabc")).toBeTruthy();
  });

  it("clears every stored account along with memory", () => {
    writeHistoryCache("evm:0xabc", {
      pages: [page([row("a")], null)],
      pageParams: [null],
    });
    writeHistoryCache("solana:xyz", {
      pages: [page([row("b")], null)],
      pageParams: [null],
    });

    clearHistoryCache();

    expect(readHistoryCache("evm:0xabc")).toBeUndefined();
    expect(readHistoryCache("solana:xyz")).toBeUndefined();
    expect(store.size).toBe(0);
  });

  it("folds newcomers in at the top and updates known rows in place", () => {
    const current: InfiniteData<HistoryPage, string | null> = {
      pages: [page([row("a", "pending"), row("b")], "cursor-2"), page([row("c")], null)],
      pageParams: [null, "cursor-2"],
    };
    const fresh = page([row("new"), row("a", "settled")], "cursor-2");

    const merged = mergeNewestPage(current, fresh);

    expect(merged.pages[0].transactions.map((r) => r.id)).toEqual([
      "new",
      "a",
      "b",
    ]);
    expect(merged.pages[0].transactions[1].state).toBe("settled");
    expect(merged.pages[1].transactions.map((r) => r.id)).toEqual(["c"]);
    expect(merged.pages[0].nextCursor).toBe("cursor-2");
  });

  it("adopts the fresh cursor when the cached first page was empty", () => {
    const current: InfiniteData<HistoryPage, string | null> = {
      pages: [page([], null)],
      pageParams: [null],
    };

    const merged = mergeNewestPage(current, page([row("new")], "cursor-1"));

    expect(merged.pages[0].transactions.map((r) => r.id)).toEqual(["new"]);
    expect(merged.pages[0].nextCursor).toBe("cursor-1");
  });
});
