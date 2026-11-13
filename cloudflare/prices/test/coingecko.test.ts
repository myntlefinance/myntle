import { describe, expect, it } from "vitest";
import type { FetchLike } from "../src/lib/http";
import { createCoingeckoSource } from "../src/sources/coingecko";

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

function candle(index: number): [number, number, number, number, number] {
  const time = NOW - (47 - index) * 1_800_000;
  return [time, 100 + index, 101 + index, 99 + index, 100 + index];
}

describe("coingecko fetchSeries", () => {
  it("parses 48 OHLC candles and plots the close", async () => {
    const { calls, fetchImpl } = mock(async () =>
      json(Array.from({ length: 48 }, (_, index) => candle(index))),
    );
    const source = createCoingeckoSource({ now: () => NOW, fetchImpl });

    const result = await source.fetchSeries("near");

    expect(calls[0]?.url).toBe(
      "https://api.coingecko.com/api/v3/coins/near/ohlc?vs_currency=usd&days=1",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.source).toBe("coingecko");
    expect(result.value.points).toHaveLength(48);
    expect(result.value.points[0]).toEqual({
      time: NOW - 47 * 1_800_000,
      value: 100,
    });
    expect(result.value.points.at(-1)).toEqual({ time: NOW, value: 147 });
    expect(result.value.changePct).toBeCloseTo(47);
  });

  it("returns rate-limited on a 429 and never retries it", async () => {
    let calls = 0;
    const { fetchImpl } = mock(async () => {
      calls += 1;
      return json({ error: "rate limited" }, 429, { "retry-after": "60" });
    });
    const source = createCoingeckoSource({ now: () => NOW, fetchImpl });

    expect(await source.fetchSeries("near")).toEqual({
      ok: false,
      error: "rate-limited",
      status: 429,
      retryAfterMs: 60_000,
    });
    expect(calls).toBe(1);
  });

  it("sends no key by default and the demo key when configured", async () => {
    const first = mock(async () =>
      json(Array.from({ length: 48 }, (_, index) => candle(index))),
    );
    await createCoingeckoSource({ fetchImpl: first.fetchImpl }).fetchSeries(
      "near",
    );
    expect(header(first.calls[0]?.init, "x-cg-demo-api-key")).toBeNull();

    const second = mock(async () =>
      json(Array.from({ length: 48 }, (_, index) => candle(index))),
    );
    await createCoingeckoSource({
      coingeckoKey: "demo-key",
      fetchImpl: second.fetchImpl,
    }).fetchSeries("near");
    expect(header(second.calls[0]?.init, "x-cg-demo-api-key")).toBe("demo-key");
  });

  it("uses the pro host and header when a pro key is configured", async () => {
    const { calls, fetchImpl } = mock(async () =>
      json(Array.from({ length: 48 }, (_, index) => candle(index))),
    );
    const source = createCoingeckoSource({
      coingeckoKey: "demo-key",
      coingeckoProKey: "pro-key",
      fetchImpl,
    });

    await source.fetchSeries("near");

    expect(calls[0]?.url).toContain(
      "https://pro-api.coingecko.com/api/v3/coins/near/ohlc",
    );
    expect(header(calls[0]?.init, "x-cg-pro-api-key")).toBe("pro-key");
    expect(header(calls[0]?.init, "x-cg-demo-api-key")).toBeNull();
  });

  it("keeps a short answer rather than inventing candles", async () => {
    const { fetchImpl } = mock(async () =>
      json(Array.from({ length: 2 }, (_, index) => candle(index))),
    );
    const source = createCoingeckoSource({ now: () => NOW, fetchImpl });

    const result = await source.fetchSeries("near");

    expect(result.ok && result.value.points).toHaveLength(2);
  });

  it("marks a 404 as unsupported", async () => {
    const { fetchImpl } = mock(async () => json({ error: "not found" }, 404));
    const source = createCoingeckoSource({ fetchImpl });

    expect(await source.fetchSeries("not-a-coin")).toEqual({
      ok: false,
      error: "unsupported",
      status: 404,
    });
  });

  it("returns malformed-response for a body that is not OHLC", async () => {
    const { fetchImpl } = mock(async () => json({ prices: [] }));
    const source = createCoingeckoSource({ fetchImpl });

    expect(await source.fetchSeries("near")).toEqual({
      ok: false,
      error: "malformed-response",
    });
  });

  it("drops malformed candles and keeps the valid ones", async () => {
    const { fetchImpl } = mock(async () =>
      json([
        candle(0),
        [],
        [NOW, "1", "2"],
        [NOW + 1, "1", "2", "0.5", "not-a-number"],
        candle(47),
      ]),
    );
    const source = createCoingeckoSource({ now: () => NOW, fetchImpl });

    const result = await source.fetchSeries("near");

    expect(result.ok && result.value.points).toHaveLength(2);
  });
});
