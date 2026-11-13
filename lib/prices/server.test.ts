import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLivePrice, getLivePrices } from "./server";

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  vi.stubEnv("PRICES_HTTP_URL", "https://prices.test");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("getLivePrices", () => {
  it("returns an empty map without a fetch when the rollout flag is off", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("NEXT_PUBLIC_PRICES_LIVE", "0");

    await expect(
      getLivePrices(["nep141:wrap.near", "nep141:usdc.near"]),
    ).resolves.toEqual(new Map());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("parses a quote map and skips null or malformed entries", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        prices: {
          "nep141:wrap.near": {
            usd: 3.482,
            asOf: 1_762_800_000_000,
            source: "binance",
            stale: false,
          },
          "nep141:usdc.near": null,
          "nep141:broken": { usd: "1", asOf: 1, source: "binance" },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const prices = await getLivePrices([
      "nep141:wrap.near",
      "nep141:usdc.near",
      "nep141:broken",
    ]);

    expect(prices.size).toBe(1);
    expect(prices.get("nep141:wrap.near")).toEqual({
      usd: 3.482,
      asOf: 1_762_800_000_000,
      source: "binance",
      stale: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      "https://prices.test/prices?assets=nep141%3Awrap.near,nep141%3Ausdc.near,nep141%3Abroken",
    );
    expect(init.cache).toBe("no-store");
  });

  it("rejects a zero or negative live price", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          prices: {
            "nep141:zero.near": {
              usd: 0,
              asOf: 1_762_800_000_000,
              source: "binance",
            },
            "nep141:negative.near": {
              usd: -1,
              asOf: 1_762_800_000_000,
              source: "binance",
            },
          },
        }),
      ),
    );

    await expect(
      getLivePrices(["nep141:zero.near", "nep141:negative.near"]),
    ).resolves.toEqual(new Map());
  });

  it("returns an empty map when the Worker answers non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ prices: {} }, 503)),
    );

    await expect(getLivePrices(["nep141:wrap.near"])).resolves.toEqual(
      new Map(),
    );
  });

  it("returns an empty map when the network fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connection refused");
      }),
    );

    await expect(getLivePrices(["nep141:wrap.near"])).resolves.toEqual(
      new Map(),
    );
  });

  it("returns an empty map when the request exceeds the server budget", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            });
          }),
      ),
    );

    const pending = getLivePrices(["nep141:wrap.near"]);
    await vi.advanceTimersByTimeAsync(1_500);

    await expect(pending).resolves.toEqual(new Map());
  });

  it("chunks requests at the Worker's 50-id cap", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ prices: {} }));
    vi.stubGlobal("fetch", fetchMock);

    const ids = Array.from({ length: 120 }, (_, index) => `asset-${index}`);
    await getLivePrices(ids);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const calls = fetchMock.mock.calls as unknown as Array<[string]>;
    const sizes = calls.map((call) => {
      const url = new URL(String(call[0]));
      return (url.searchParams.get("assets") ?? "").split(",").length;
    });
    expect(sizes).toEqual([50, 50, 20]);
  });

  it("keeps the quotes from a chunk that succeeded when another fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          prices: {
            "asset-0": {
              usd: 1,
              asOf: 1_762_800_000_000,
              source: "binance",
            },
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ prices: {} }, 503));
    vi.stubGlobal("fetch", fetchMock);

    const ids = Array.from({ length: 60 }, (_, index) => `asset-${index}`);
    const prices = await getLivePrices(ids);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(prices.size).toBe(1);
    expect(prices.get("asset-0")?.usd).toBe(1);
  });

  it("dedupes ids before it counts the cap", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ prices: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await getLivePrices(["a", "a", " b ", ""]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [[call]] = fetchMock.mock.calls as unknown as Array<
      [string, RequestInit?]
    >;
    const url = new URL(String(call));
    expect(url.searchParams.get("assets")).toBe("a,b");
  });

  it("does not call the Worker for an empty list", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getLivePrices([])).resolves.toEqual(new Map());
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("getLivePrice", () => {
  it("returns the one quote the Worker priced", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          prices: {
            "nep141:wrap.near": {
              usd: 3.5,
              asOf: 1_762_800_000_000,
              source: "alchemy",
              stale: true,
            },
          },
        }),
      ),
    );

    await expect(getLivePrice("nep141:wrap.near")).resolves.toMatchObject({
      usd: 3.5,
      source: "alchemy",
      stale: true,
    });
  });

  it("returns undefined for an empty id without a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getLivePrice("  ")).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
