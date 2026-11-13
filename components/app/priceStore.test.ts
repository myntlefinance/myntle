import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  __resetPriceStoreForTests,
  configurePriceStore,
  getQuote,
  seedQuote,
  subscribe,
  subscribeAssets,
  unsubscribe,
} from "./priceStore";

/* ── a WebSocket that the test drives by hand ─────────────── */

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  url: string;
  readyState = 0;
  closed = false;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  message(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  fail() {
    this.readyState = 3;
    this.onclose?.();
  }

  close() {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.();
  }
}

/* ── sessionStorage and window, which Node does not have ──── */

const storageData = new Map<string, string>();

const mockStorage = {
  getItem: (key: string) => storageData.get(key) ?? null,
  setItem: (key: string, value: string) => {
    storageData.set(key, value);
  },
  removeItem: (key: string) => {
    storageData.delete(key);
  },
  clear: () => storageData.clear(),
  key: (index: number) => [...storageData.keys()][index] ?? null,
  get length() {
    return storageData.size;
  },
};

const windowListeners = new Map<string, Set<() => void>>();

const fakeWindow = {
  sessionStorage: mockStorage,
  addEventListener: (type: string, listener: () => void) => {
    const set = windowListeners.get(type) ?? new Set();
    set.add(listener);
    windowListeners.set(type, set);
  },
  removeEventListener: (type: string, listener: () => void) => {
    windowListeners.get(type)?.delete(listener);
  },
};

function useBrowser() {
  vi.stubGlobal("window", fakeWindow);
  vi.stubGlobal("WebSocket", MockWebSocket);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0);
  MockWebSocket.instances = [];
  storageData.clear();
  windowListeners.clear();
  useBrowser();
  configurePriceStore({
    wsUrl: "wss://test/ws",
    httpUrl: "https://test",
  });
  __resetPriceStoreForTests();
});

afterEach(() => {
  __resetPriceStoreForTests();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("priceStore", () => {
  it("opens one socket and sends the watched set in one frame", () => {
    subscribeAssets(["a", "b"]);
    expect(MockWebSocket.instances).toHaveLength(1);

    const ws = MockWebSocket.instances[0];
    expect(ws.url).toBe("wss://test/ws");
    ws.open();

    expect(ws.sent).toEqual([
      JSON.stringify({ t: "sub", assets: ["a", "b"] }),
    ]);
  });

  it("sends one frame for a later subscribe and one for an unsubscribe", () => {
    subscribe("a");
    const ws = MockWebSocket.instances[0];
    ws.open();

    subscribe("b");
    expect(ws.sent.at(-1)).toBe(
      JSON.stringify({ t: "sub", assets: ["b"] }),
    );

    unsubscribe("a");
    expect(ws.sent.at(-1)).toBe(
      JSON.stringify({ t: "unsub", assets: ["a"] }),
    );
  });

  it("merges snapshot and patch tuples and keeps unchanged references", () => {
    subscribe("a");
    const ws = MockWebSocket.instances[0];
    ws.open();

    const now = Date.now();
    ws.message({
      t: "snapshot",
      prices: [["a", 1.5, now, "binance", false]],
    });
    const first = getQuote("a");
    expect(first).toMatchObject({
      assetId: "a",
      usd: 1.5,
      asOf: now,
      source: "binance",
      stale: false,
    });

    ws.message({
      t: "patch",
      prices: [["a", 1.5, now, "binance", false]],
    });
    expect(getQuote("a")).toBe(first);

    ws.message({
      t: "patch",
      prices: [["a", 2, now + 1, "alchemy", true]],
    });
    expect(getQuote("a")).toMatchObject({
      usd: 2,
      source: "alchemy",
      stale: true,
    });
  });

  it("ignores malformed tuples instead of zeroing a price", () => {
    subscribe("a");
    const ws = MockWebSocket.instances[0];
    ws.open();

    ws.message({
      t: "patch",
      prices: [
        ["a"],
        ["b", "not-a-number", Date.now(), "binance", false],
        ["c", 1, Date.now(), "unknown-source", false],
        null,
      ],
    });

    expect(getQuote("a")).toBeUndefined();
    expect(getQuote("b")).toBeUndefined();
    expect(getQuote("c")).toBeUndefined();
  });

  it("rejects a zero or negative quote instead of zeroing a row", () => {
    subscribe("a");
    const ws = MockWebSocket.instances[0];
    ws.open();
    const now = Date.now();

    ws.message({
      t: "snapshot",
      prices: [["a", 1.5, now, "binance", false]],
    });
    ws.message({
      t: "patch",
      prices: [
        ["a", 0, now + 1, "binance", false],
        ["b", -2, now + 1, "binance", false],
      ],
    });

    expect(getQuote("a")?.usd).toBe(1.5);
    expect(getQuote("b")).toBeUndefined();
  });

  it("keeps the quote after the last subscriber leaves", () => {
    subscribe("a");
    const ws = MockWebSocket.instances[0];
    ws.open();
    ws.message({
      t: "snapshot",
      prices: [["a", 1.5, Date.now(), "binance", false]],
    });

    unsubscribe("a");
    expect(getQuote("a")?.usd).toBe(1.5);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("keeps the socket open for 60s after the last unsubscribe", async () => {
    subscribe("a");
    const ws = MockWebSocket.instances[0];
    ws.open();

    unsubscribe("a");
    expect(ws.closed).toBe(false);

    await vi.advanceTimersByTimeAsync(59_000);
    expect(ws.closed).toBe(false);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(ws.closed).toBe(true);
  });

  it("cancels the idle close when a new subscriber arrives", async () => {
    subscribe("a");
    const ws = MockWebSocket.instances[0];
    ws.open();

    unsubscribe("a");
    await vi.advanceTimersByTimeAsync(30_000);
    subscribe("b");

    await vi.advanceTimersByTimeAsync(60_000);
    expect(ws.closed).toBe(false);
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(ws.sent.at(-1)).toBe(
      JSON.stringify({ t: "sub", assets: ["b"] }),
    );
  });

  it("closes the socket immediately on pagehide", () => {
    subscribe("a");
    const ws = MockWebSocket.instances[0];
    ws.open();

    for (const listener of windowListeners.get("pagehide") ?? []) {
      listener();
    }

    expect(ws.closed).toBe(true);
  });

  it("reconnects with 1s, then 2s backoff", async () => {
    subscribe("a");
    expect(MockWebSocket.instances).toHaveLength(1);

    MockWebSocket.instances[0].fail();
    await vi.advanceTimersByTimeAsync(999);
    expect(MockWebSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(MockWebSocket.instances).toHaveLength(2);

    MockWebSocket.instances[1].fail();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(MockWebSocket.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(MockWebSocket.instances).toHaveLength(3);
  });

  it("does not open a socket while a reconnect timer is pending", async () => {
    subscribe("a");
    MockWebSocket.instances[0].fail();
    expect(MockWebSocket.instances).toHaveLength(1);

    // A new subscription during backoff must wait for the scheduled retry.
    subscribe("b");
    expect(MockWebSocket.instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(MockWebSocket.instances).toHaveLength(2);

    const second = MockWebSocket.instances[1];
    second.open();
    expect(second.sent).toEqual([
      JSON.stringify({ t: "sub", assets: ["a", "b"] }),
    ]);
  });

  it("resubscribes the whole set when a reconnect opens", async () => {
    subscribeAssets(["a", "b"]);
    MockWebSocket.instances[0].fail();
    await vi.advanceTimersByTimeAsync(1_000);

    const second = MockWebSocket.instances[1];
    second.open();
    expect(second.sent).toEqual([
      JSON.stringify({ t: "sub", assets: ["a", "b"] }),
    ]);
  });

  it("falls back to batched HTTP after three failed attempts", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        prices: {
          a: {
            usd: 3,
            asOf: Date.now(),
            source: "binance",
            stale: false,
          },
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    subscribe("a");
    MockWebSocket.instances[0].fail();
    await vi.advanceTimersByTimeAsync(1_000);
    MockWebSocket.instances[1].fail();
    await vi.advanceTimersByTimeAsync(2_000);
    MockWebSocket.instances[2].fail();
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://test/prices?assets=a",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(getQuote("a")?.usd).toBe(3);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries the socket five minutes after the fallback starts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ prices: {} }),
      }),
    );

    subscribe("a");
    MockWebSocket.instances[0].fail();
    await vi.advanceTimersByTimeAsync(1_000);
    MockWebSocket.instances[1].fail();
    await vi.advanceTimersByTimeAsync(2_000);
    MockWebSocket.instances[2].fail();
    await vi.advanceTimersByTimeAsync(0);
    expect(MockWebSocket.instances).toHaveLength(3);

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(MockWebSocket.instances).toHaveLength(4);
  });

  it("times out a hung fallback fetch instead of blocking forever", async () => {
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    subscribe("a");
    MockWebSocket.instances[0].fail();
    await vi.advanceTimersByTimeAsync(1_000);
    MockWebSocket.instances[1].fail();
    await vi.advanceTimersByTimeAsync(2_000);
    MockWebSocket.instances[2].fail();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // The 5s abort releases the in-flight guard, so the next tick can run.
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops the fallback when the socket opens again", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ prices: {} }),
    });
    vi.stubGlobal("fetch", fetchMock);

    subscribe("a");
    MockWebSocket.instances[0].fail();
    await vi.advanceTimersByTimeAsync(1_000);
    MockWebSocket.instances[1].fail();
    await vi.advanceTimersByTimeAsync(2_000);
    MockWebSocket.instances[2].fail();
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    const retry = MockWebSocket.instances.at(-1);
    expect(retry).toBeDefined();
    retry?.open();

    const calls = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it("hydrates a fresh seed, marks an old one stale, and drops the rest", () => {
    const now = Date.now();
    storageData.set(
      "myntle-prices-v1",
      JSON.stringify({
        v: 1,
        quotes: {
          a: [1.5, now, "binance", false],
          b: [2, now - 45_000, "binance", false],
          c: [3, now - 61_000, "binance", false],
        },
      }),
    );

    __resetPriceStoreForTests();

    expect(getQuote("a")?.usd).toBe(1.5);
    expect(getQuote("a")?.stale).toBe(false);
    expect(getQuote("b")?.usd).toBe(2);
    expect(getQuote("b")?.stale).toBe(true);
    expect(getQuote("c")).toBeUndefined();
  });

  it("seeds a catalogue price without overwriting a live quote", () => {
    const now = Date.now();
    seedQuote("a", 1, now, "oneclick", true);
    expect(getQuote("a")?.usd).toBe(1);

    seedQuote("a", 2, now + 1, "oneclick", true);
    expect(getQuote("a")?.usd).toBe(1);
  });

  it("never creates a socket without a browser window", () => {
    vi.unstubAllGlobals();
    vi.stubGlobal("WebSocket", MockWebSocket);

    subscribe("a");
    expect(MockWebSocket.instances).toHaveLength(0);
    unsubscribe("a");
  });

  describe("with the rollout flag off", () => {
    beforeEach(() => {
      vi.stubEnv("NEXT_PUBLIC_PRICES_LIVE", "0");
    });

    it("does not open a socket or start the HTTP fallback", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ prices: {} }),
      });
      vi.stubGlobal("fetch", fetchMock);

      subscribeAssets(["a", "b"]);
      await vi.advanceTimersByTimeAsync(60_000);

      expect(MockWebSocket.instances).toHaveLength(0);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("does not seed a catalogue price into the store", () => {
      seedQuote("a", 1.5, Date.now(), "oneclick", true);
      expect(getQuote("a")).toBeUndefined();
    });

    it("does not open a socket even when a quote is already in the store", () => {
      // Seed while the flag is on, then turn it off the way a rollout would.
      vi.stubEnv("NEXT_PUBLIC_PRICES_LIVE", "1");
      seedQuote("a", 1.5, Date.now(), "oneclick", true);
      expect(getQuote("a")?.usd).toBe(1.5);

      vi.stubEnv("NEXT_PUBLIC_PRICES_LIVE", "0");
      subscribe("a");
      expect(MockWebSocket.instances).toHaveLength(0);
    });
  });
});
