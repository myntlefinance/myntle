import { describe, expect, it } from "vitest";
import type { FetchLike } from "../src/lib/http";
import { createBinanceSource } from "../src/sources/binance";

const NOW = 1_762_000_000_000;

type Call = { url: string; init?: RequestInit };

function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function mock(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return { calls, fetchImpl };
}

function header(init: RequestInit | undefined, name: string): string | null {
  if (init?.headers === undefined) return null;
  return new Headers(init.headers).get(name);
}

function kline(index: number): unknown[] {
  const openTime = NOW - (47 - index) * 1_800_000;
  return [
    openTime,
    "1.00",
    "2.00",
    "0.50",
    String(100 + index),
    "1000",
    openTime + 1_799_999,
  ];
}

describe("binance fetchCurrent", () => {
  it("prices a batch and stamps it with the call time", async () => {
    const { calls, fetchImpl } = mock(async () =>
      json([
        { symbol: "BTCUSDT", price: "74277.73000000" },
        { symbol: "ETHUSDT", price: "2080.83" },
      ]),
    );
    const source = createBinanceSource({ now: () => NOW, fetchImpl });

    const result = await source.fetchCurrent(["BTCUSDT", "ETHUSDT"]);

    expect(result).toEqual({
      ok: true,
      value: [
        { symbol: "BTCUSDT", usd: 74277.73, asOf: NOW, source: "binance" },
        { symbol: "ETHUSDT", usd: 2080.83, asOf: NOW, source: "binance" },
      ],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain("https://api.binance.us/api/v3/ticker/price");
    expect(decodeURIComponent(calls[0]?.url ?? "")).toContain(
      'symbols=["BTCUSDT","ETHUSDT"]',
    );
  });

  it("rotates to the next US host on a 451", async () => {
    let call = 0;
    const { calls, fetchImpl } = mock(async () => {
      call += 1;
      if (call === 1) return json({ code: 0, msg: "restricted location" }, 451);
      return json([{ symbol: "NEARUSDT", price: "3.70" }]);
    });
    const source = createBinanceSource({ now: () => NOW, fetchImpl });

    const result = await source.fetchCurrent(["NEARUSDT"]);

    expect(result.ok).toBe(true);
    expect(calls.map((entry) => new URL(entry.url).host)).toEqual([
      "api.binance.us",
      "api1.binance.us",
    ]);
  });

  it("rotates on a 403 and on a 5xx", async () => {
    let call = 0;
    const { calls, fetchImpl } = mock(async () => {
      call += 1;
      if (call === 1) return json({}, 403);
      if (call === 2) return json({}, 500);
      if (call === 3) return json({}, 500);
      return json([{ symbol: "BTCUSDT", price: "1" }]);
    });
    const source = createBinanceSource({ now: () => NOW, fetchImpl });

    const result = await source.fetchCurrent(["BTCUSDT"]);

    expect(result.ok).toBe(true);
    // 403 rotates immediately; a 500 is retried once on the same host first.
    expect(calls.map((entry) => new URL(entry.url).host)).toEqual([
      "api.binance.us",
      "api1.binance.us",
      "api1.binance.us",
      "api2.binance.us",
    ]);
  });

  it("does not rotate on a 429 and keeps Retry-After", async () => {
    const { calls, fetchImpl } = mock(async () =>
      json({ code: -1003, msg: "too many requests" }, 429, {
        "retry-after": "30",
      }),
    );
    const source = createBinanceSource({ now: () => NOW, fetchImpl });

    const result = await source.fetchCurrent(["BTCUSDT"]);

    expect(result).toEqual({
      ok: false,
      error: "rate-limited",
      status: 429,
      retryAfterMs: 30_000,
    });
    expect(calls).toHaveLength(1);
  });

  it("does not rotate on a 418 IP ban", async () => {
    const { calls, fetchImpl } = mock(async () =>
      json({ code: -1003 }, 418, { "retry-after": "120" }),
    );
    const source = createBinanceSource({ now: () => NOW, fetchImpl });

    const result = await source.fetchCurrent(["BTCUSDT"]);

    expect(result).toEqual({
      ok: false,
      error: "rate-limited",
      status: 418,
      retryAfterMs: 120_000,
    });
    expect(calls).toHaveLength(1);
  });

  it("chunks a large batch at 100 symbols", async () => {
    const { calls, fetchImpl } = mock(async (url) => {
      const symbols = JSON.parse(
        new URL(url).searchParams.get("symbols") ?? "[]",
      ) as string[];
      return json(symbols.map((symbol) => ({ symbol, price: "1" })));
    });
    const source = createBinanceSource({ now: () => NOW, fetchImpl });
    const pairs = Array.from({ length: 101 }, (_, index) => `S${index}USDT`);

    const result = await source.fetchCurrent(pairs);

    expect(calls).toHaveLength(2);
    expect(result.ok && result.value).toHaveLength(101);
  });

  it("marks a partly failed chunk walk as partial", async () => {
    let call = 0;
    const { calls, fetchImpl } = mock(async (url) => {
      call += 1;
      if (call === 2) {
        return json({}, 429, { "retry-after": "5" });
      }
      const symbols = JSON.parse(
        new URL(url).searchParams.get("symbols") ?? "[]",
      ) as string[];
      return json(symbols.map((symbol) => ({ symbol, price: "1" })));
    });
    const source = createBinanceSource({ now: () => NOW, fetchImpl });
    const pairs = Array.from({ length: 150 }, (_, index) => `S${index}USDT`);

    const result = await source.fetchCurrent(pairs);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toHaveLength(100);
    expect(result.partial).toBe(true);
    expect(result.failedChunks).toBe(1);
    expect(result.retryAfterMs).toBe(5_000);
    // A 429 is a rate decision, not a bad host: no rotation, no retry.
    expect(calls).toHaveLength(2);
  });

  it("sends no key by default and the optional key when configured", async () => {
    const first = mock(async () => json([{ symbol: "BTCUSDT", price: "1" }]));
    await createBinanceSource({ fetchImpl: first.fetchImpl }).fetchCurrent([
      "BTCUSDT",
    ]);
    expect(header(first.calls[0]?.init, "x-mbx-apikey")).toBeNull();

    const second = mock(async () => json([{ symbol: "BTCUSDT", price: "1" }]));
    await createBinanceSource({
      binanceUsKey: "test-key",
      fetchImpl: second.fetchImpl,
    }).fetchCurrent(["BTCUSDT"]);
    expect(header(second.calls[0]?.init, "x-mbx-apikey")).toBe("test-key");
  });

  it("tries the global host first only when it is enabled", async () => {
    const { calls, fetchImpl } = mock(async () =>
      json([{ symbol: "BTCUSDT", price: "1" }]),
    );
    const source = createBinanceSource({
      binanceGlobal: true,
      fetchImpl,
    });

    await source.fetchCurrent(["BTCUSDT"]);

    expect(new URL(calls[0]?.url ?? "").host).toBe("api.binance.com");
  });

  it("rotates off the global host when it answers 451", async () => {
    let call = 0;
    const { calls, fetchImpl } = mock(async () => {
      call += 1;
      if (call === 1) return json({}, 451);
      return json([{ symbol: "BTCUSDT", price: "1" }]);
    });
    const source = createBinanceSource({
      binanceGlobal: true,
      fetchImpl,
    });

    const result = await source.fetchCurrent(["BTCUSDT"]);

    expect(result.ok).toBe(true);
    expect(calls.map((entry) => new URL(entry.url).host)).toEqual([
      "api.binance.com",
      "api.binance.us",
    ]);
  });

  it("returns a malformed-response error for a body that is not a ticker list", async () => {
    const { calls, fetchImpl } = mock(async () =>
      json({ code: -1121, msg: "Invalid symbol." }),
    );
    const source = createBinanceSource({ now: () => NOW, fetchImpl });

    const result = await source.fetchCurrent(["NOPEUSDT"]);

    expect(result).toEqual({ ok: false, error: "malformed-response" });
    expect(calls).toHaveLength(3);
  });

  it("returns an empty list without a call when there are no pairs", async () => {
    const { calls, fetchImpl } = mock(async () => json([]));
    const source = createBinanceSource({ fetchImpl });

    expect(await source.fetchCurrent([])).toEqual({ ok: true, value: [] });
    expect(calls).toHaveLength(0);
  });

  it("stops rotating once the total budget is spent", async () => {
    let clock = NOW;
    const { calls, fetchImpl } = mock(async () => {
      clock += 5_000;
      return json({}, 451);
    });
    const source = createBinanceSource({
      now: () => clock,
      binanceMaxMs: 8_000,
      fetchImpl,
    });

    const result = await source.fetchCurrent(["BTCUSDT"]);

    expect(result).toEqual({ ok: false, error: "http-451", status: 451 });
    // The third host would start after the eight-second deadline.
    expect(calls).toHaveLength(2);
  });

  it("defaults to the four-second hot-path budget", async () => {
    let clock = NOW;
    const { calls, fetchImpl } = mock(async () => {
      clock += 5_000;
      return json({}, 451);
    });
    const source = createBinanceSource({ now: () => clock, fetchImpl });

    const result = await source.fetchCurrent(["BTCUSDT"]);

    expect(result).toEqual({ ok: false, error: "http-451", status: 451 });
    // Five seconds is already past the default four-second deadline.
    expect(calls).toHaveLength(1);
  });

  it("keeps the global host out for ten minutes after a 451", async () => {
    let clock = NOW;
    const hosts: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      const host = new URL(url).host;
      hosts.push(host);
      if (host === "api.binance.com") return json({}, 451);
      return json([{ symbol: "BTCUSDT", price: "1" }]);
    };
    const source = createBinanceSource({
      binanceGlobal: true,
      now: () => clock,
      fetchImpl,
    });

    expect((await source.fetchCurrent(["BTCUSDT"])).ok).toBe(true);
    expect(hosts).toEqual(["api.binance.com", "api.binance.us"]);

    hosts.length = 0;
    await source.fetchCurrent(["BTCUSDT"]);
    expect(hosts).toEqual(["api.binance.us"]);

    clock += 10 * 60_000;
    hosts.length = 0;
    await source.fetchCurrent(["BTCUSDT"]);
    expect(hosts[0]).toBe("api.binance.com");
  });
});

describe("binance fetchSeries", () => {
  it("returns 48 half-hour candles with the close of each", async () => {
    const { calls, fetchImpl } = mock(async () =>
      json(Array.from({ length: 48 }, (_, index) => kline(index))),
    );
    const source = createBinanceSource({ now: () => NOW, fetchImpl });

    const result = await source.fetchSeries("nearusdt");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.source).toBe("binance");
    expect(result.value.points).toHaveLength(48);
    expect(result.value.points[0]).toEqual({
      time: NOW - 47 * 1_800_000,
      value: 100,
    });
    expect(result.value.points.at(-1)).toEqual({ time: NOW, value: 147 });
    expect(result.value.changePct).toBeCloseTo(47);
    expect(result.value.incomplete).toBeUndefined();
    expect(decodeURIComponent(calls[0]?.url ?? "")).toContain(
      "symbol=NEARUSDT&interval=30m&limit=48",
    );
  });

  it("returns a short answer with incomplete: true instead of failing", async () => {
    const { fetchImpl } = mock(async () =>
      json(Array.from({ length: 47 }, (_, index) => kline(index))),
    );
    const source = createBinanceSource({ now: () => NOW, fetchImpl });

    const result = await source.fetchSeries("NEARUSDT");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.points).toHaveLength(47);
    expect(result.value.incomplete).toBe(true);
  });

  it("returns malformed-response when klines is not an array", async () => {
    const { fetchImpl } = mock(async () => json({ code: 451 }));

    expect(
      await createBinanceSource({ fetchImpl }).fetchSeries("NEARUSDT"),
    ).toEqual({ ok: false, error: "malformed-response" });
  });

  it("rejects an empty pair without a call", async () => {
    const { calls, fetchImpl } = mock(async () => json([]));

    expect(await createBinanceSource({ fetchImpl }).fetchSeries("  ")).toEqual({
      ok: false,
      error: "invalid-symbol",
    });
    expect(calls).toHaveLength(0);
  });
});
