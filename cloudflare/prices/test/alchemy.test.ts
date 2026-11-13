import { describe, expect, it } from "vitest";
import type { FetchLike } from "../src/lib/http";
import { createAlchemySource } from "../src/sources/alchemy";

const NOW = 1_762_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const UPDATED_AT = "2026-11-10T13:48:30.764Z";

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

function symbolsFrom(url: string): string[] {
  const raw = new URL(url).searchParams.get("symbols") ?? "";
  return raw.length === 0 ? [] : raw.split(",");
}

describe("alchemy fetchCurrent", () => {
  it("chunks 60 symbols into three calls of at most 25", async () => {
    const { calls, fetchImpl } = mock(async (url) =>
      json({
        data: symbolsFrom(url).map((symbol) => ({
          symbol,
          prices: [
            { currency: "usd", value: "1.50", lastUpdatedAt: UPDATED_AT },
          ],
        })),
      }),
    );
    const source = createAlchemySource({
      alchemyKey: "test-key",
      fetchImpl,
    });
    const symbols = Array.from({ length: 60 }, (_, index) => `S${index}`);

    const result = await source.fetchCurrent(symbols);

    expect(calls).toHaveLength(3);
    expect(calls.map((entry) => symbolsFrom(entry.url).length)).toEqual([
      25, 25, 10,
    ]);
    expect(result.ok && result.value).toHaveLength(60);
    expect(calls[0]?.url).toContain(
      "https://api.g.alchemy.com/prices/v1/test-key/tokens/by-symbol",
    );
  });

  it("marks a partly failed chunk walk as partial", async () => {
    const { fetchImpl } = mock(async (url) => {
      const symbols = symbolsFrom(url);
      if (symbols[0] === "S25") return json({}, 500);
      return json({
        data: symbols.map((symbol) => ({
          symbol,
          prices: [
            { currency: "usd", value: "1.50", lastUpdatedAt: UPDATED_AT },
          ],
        })),
      });
    });
    const source = createAlchemySource({ alchemyKey: "test-key", fetchImpl });
    const symbols = Array.from({ length: 60 }, (_, index) => `S${index}`);

    const result = await source.fetchCurrent(symbols);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toHaveLength(35);
    expect(result.partial).toBe(true);
    expect(result.failedChunks).toBe(1);
  });

  it("uses lastUpdatedAt for asOf", async () => {
    const { fetchImpl } = mock(async () =>
      json({
        data: [
          {
            symbol: "BTC",
            prices: [
              { currency: "usd", value: "74277.73", lastUpdatedAt: UPDATED_AT },
            ],
          },
        ],
      }),
    );
    const source = createAlchemySource({ alchemyKey: "k", now: () => NOW, fetchImpl });

    expect(await source.fetchCurrent(["BTC"])).toEqual({
      ok: true,
      value: [
        {
          symbol: "BTC",
          usd: 74277.73,
          asOf: Date.parse(UPDATED_AT),
          source: "alchemy",
        },
      ],
    });
  });

  it("falls back to the fetch time when a price has no timestamp", async () => {
    const { fetchImpl } = mock(async () =>
      json({
        data: [
          { symbol: "NEAR", prices: [{ currency: "usd", value: "3.707" }] },
        ],
      }),
    );
    const source = createAlchemySource({ alchemyKey: "k", now: () => NOW, fetchImpl });

    const result = await source.fetchCurrent(["NEAR"]);

    expect(result.ok && result.value[0]?.asOf).toBe(NOW);
  });

  it("skips an unsupported symbol row with empty prices instead of zeroing it", async () => {
    const { fetchImpl } = mock(async () =>
      json({
        data: [
          {
            symbol: "NOPE",
            prices: [],
            error: { message: "Price not found for symbol: NOPE" },
          },
          {
            symbol: "BTC",
            prices: [{ currency: "usd", value: "74277.73", lastUpdatedAt: UPDATED_AT }],
          },
        ],
      }),
    );
    const source = createAlchemySource({ alchemyKey: "k", now: () => NOW, fetchImpl });

    const result = await source.fetchCurrent(["NOPE", "BTC"]);

    expect(result.ok && result.value.map((quote) => quote.symbol)).toEqual([
      "BTC",
    ]);
  });

  it("is not-configured without a key and makes no call", async () => {
    const { calls, fetchImpl } = mock(async () => json({ data: [] }));
    const source = createAlchemySource({ fetchImpl });

    expect(source.configured).toBe(false);
    expect(await source.fetchCurrent(["BTC"])).toEqual({
      ok: false,
      error: "not-configured",
    });
    expect(await source.fetchSeries("BTC")).toEqual({
      ok: false,
      error: "not-configured",
    });
    expect(calls).toHaveLength(0);
  });

  it("marks a 400 as unsupported", async () => {
    const { fetchImpl } = mock(async () =>
      json({ error: "Each symbol must be non-empty" }, 400),
    );
    const source = createAlchemySource({ alchemyKey: "k", fetchImpl });

    expect(await source.fetchCurrent(["BTC"])).toEqual({
      ok: false,
      error: "unsupported",
      status: 400,
    });
  });

  it("returns a 429 with Retry-After", async () => {
    let calls = 0;
    const { fetchImpl } = mock(async () => {
      calls += 1;
      return json({ error: "rate limited" }, 429, { "retry-after": "12" });
    });
    const source = createAlchemySource({
      alchemyKey: "k",
      now: () => NOW,
      fetchImpl,
    });

    expect(await source.fetchCurrent(["BTC"])).toEqual({
      ok: false,
      error: "rate-limited",
      status: 429,
      retryAfterMs: 12_000,
    });
    expect(calls).toBe(1);
  });

  it("returns a malformed-response error for a body without data", async () => {
    const { fetchImpl } = mock(async () => json({ result: "nope" }));
    const source = createAlchemySource({ alchemyKey: "k", fetchImpl });

    expect(await source.fetchCurrent(["BTC"])).toEqual({
      ok: false,
      error: "malformed-response",
    });
  });
});

describe("alchemy fetchCurrentByAddress", () => {
  it("posts the addresses with their networks and parses the same rows", async () => {
    const { calls, fetchImpl } = mock(async () =>
      json({
        data: [
          {
            address: "0xabc",
            networks: ["eth-mainnet"],
            symbol: "LINK",
            prices: [{ currency: "usd", value: "10.42", lastUpdatedAt: UPDATED_AT }],
          },
        ],
      }),
    );
    const source = createAlchemySource({ alchemyKey: "k", now: () => NOW, fetchImpl });

    const result = await source.fetchCurrentByAddress([
      { address: "0xabc", networks: ["eth-mainnet"] },
    ]);

    expect(calls[0]?.url).toContain("/tokens/by-address");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      addresses: [{ address: "0xabc", networks: ["eth-mainnet"] }],
    });
    expect(result.ok && result.value[0]).toEqual({
      symbol: "LINK",
      usd: 10.42,
      asOf: Date.parse(UPDATED_AT),
      source: "alchemy",
    });
  });
});

describe("alchemy fetchSeries", () => {
  function history(count = 288) {
    return Array.from({ length: count }, (_, index) => ({
      value: String(100 + (100 * index) / (count - 1)),
      timestamp: new Date(NOW - DAY_MS + index * 300_000).toISOString(),
    }));
  }

  it("requests 5m history over 24h and downsamples 288 points to 48", async () => {
    const { calls, fetchImpl } = mock(async () => json({ data: history() }));
    const source = createAlchemySource({ alchemyKey: "k", now: () => NOW, fetchImpl });

    const result = await source.fetchSeries("NEAR");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain("/tokens/historical");
    expect(calls[0]?.init?.method).toBe("POST");

    const body = JSON.parse(String(calls[0]?.init?.body));
    expect(body).toEqual({
      symbol: "NEAR",
      startTime: new Date(NOW - DAY_MS).toISOString(),
      endTime: new Date(NOW).toISOString(),
      interval: "5m",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.source).toBe("alchemy");
    expect(result.value.points).toHaveLength(48);
    expect(result.value.points[0]?.value).toBeCloseTo(100);
    expect(result.value.points.at(-1)?.value).toBeCloseTo(200);
    expect(result.value.changePct).toBeCloseTo(100);
    expect(result.value.asOf).toBe(Date.parse(new Date(NOW - 300_000).toISOString()));

    for (let index = 1; index < result.value.points.length; index++) {
      const gap =
        result.value.points[index]!.time - result.value.points[index - 1]!.time;
      expect(gap).toBeGreaterThan(0);
      expect(gap % 300_000).toBe(0);
    }
  });

  it("keeps a short series instead of padding it", async () => {
    const { fetchImpl } = mock(async () => json({ data: history(10) }));
    const source = createAlchemySource({ alchemyKey: "k", now: () => NOW, fetchImpl });

    const result = await source.fetchSeries("NEAR");

    expect(result.ok && result.value.points).toHaveLength(10);
  });

  it("treats an empty history as no-history instead of an empty success", async () => {
    const { fetchImpl } = mock(async () => json({ data: [] }));
    const source = createAlchemySource({ alchemyKey: "k", now: () => NOW, fetchImpl });

    expect(await source.fetchSeries("NEAR")).toEqual({
      ok: false,
      error: "no-history",
    });
  });

  it("reads a numeric-string epoch timestamp as seconds or milliseconds", async () => {
    const { fetchImpl } = mock(async () =>
      json({
        data: [
          { value: "3.50", timestamp: "1762000000" },
          { value: "3.60", timestamp: "1762000300000" },
        ],
      }),
    );
    const source = createAlchemySource({ alchemyKey: "k", now: () => NOW, fetchImpl });

    const result = await source.fetchSeries("NEAR");

    expect(result.ok && result.value.points).toEqual([
      { time: 1_762_000_000_000, value: 3.5 },
      { time: 1_762_000_300_000, value: 3.6 },
    ]);
  });

  it("drops a negative numeric-string epoch", async () => {
    const { fetchImpl } = mock(async () =>
      json({
        data: [
          { value: "3.50", timestamp: "-1762000000" },
          { value: "3.60", timestamp: "1762000300000" },
        ],
      }),
    );
    const source = createAlchemySource({ alchemyKey: "k", now: () => NOW, fetchImpl });

    const result = await source.fetchSeries("NEAR");

    expect(result.ok && result.value.points).toEqual([
      { time: 1_762_000_300_000, value: 3.6 },
    ]);
  });

  it("marks a 404 as unsupported", async () => {
    const { fetchImpl } = mock(async () =>
      json({ error: { message: "Token not found" } }, 404),
    );
    const source = createAlchemySource({ alchemyKey: "k", fetchImpl });

    expect(await source.fetchSeries("NOPE")).toEqual({
      ok: false,
      error: "unsupported",
      status: 404,
    });
  });

  it("returns malformed-response for a history body without data", async () => {
    const { fetchImpl } = mock(async () => json({ data: "nope" }));
    const source = createAlchemySource({ alchemyKey: "k", fetchImpl });

    expect(await source.fetchSeries("NEAR")).toEqual({
      ok: false,
      error: "malformed-response",
    });
  });
});
