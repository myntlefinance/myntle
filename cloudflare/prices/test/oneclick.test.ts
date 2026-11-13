import { describe, expect, it } from "vitest";
import type { FetchLike } from "../src/lib/http";
import { createOneclickSource } from "../src/sources/oneclick";

const NOW = 1_762_000_000_000;
const UPDATED_AT = "2026-11-10T13:48:30.764Z";

type Call = { url: string; init?: RequestInit };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
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

describe("oneclick fetchCurrent", () => {
  it("reads the flat array and keeps the assetId", async () => {
    const { calls, fetchImpl } = mock(async () =>
      json([
        {
          assetId: "nep141:wrap.near",
          symbol: "wNEAR",
          blockchain: "near",
          contractAddress: "wrap.near",
          decimals: 24,
          coingeckoId: "wrapped-near",
          price: 3.62,
          priceUpdatedAt: UPDATED_AT,
        },
        {
          assetId: "nep141:eth.bridge.near",
          symbol: "ETH",
          blockchain: "near",
          decimals: 18,
          price: 2060.4,
          priceUpdatedAt: UPDATED_AT,
        },
      ]),
    );
    const source = createOneclickSource({ now: () => NOW, fetchImpl });

    const result = await source.fetchCurrent();

    expect(calls[0]?.url).toBe(
      "https://1click.chaindefuser.com/v0/tokens",
    );
    expect(result).toEqual({
      ok: true,
      value: [
        {
          assetId: "nep141:wrap.near",
          symbol: "wNEAR",
          usd: 3.62,
          asOf: Date.parse(UPDATED_AT),
          source: "oneclick",
        },
        {
          assetId: "nep141:eth.bridge.near",
          symbol: "ETH",
          usd: 2060.4,
          asOf: Date.parse(UPDATED_AT),
          source: "oneclick",
        },
      ],
    });
  });

  it("accepts the { data: [...] } wrapper", async () => {
    const { fetchImpl } = mock(async () =>
      json({
        data: [
          {
            assetId: "nep141:btc.omft.near",
            symbol: "BTC",
            blockchain: "near",
            price: 74277.73,
            priceUpdatedAt: UPDATED_AT,
          },
        ],
      }),
    );
    const source = createOneclickSource({ fetchImpl });

    expect(await source.fetchCurrent()).toEqual({
      ok: true,
      value: [
        {
          assetId: "nep141:btc.omft.near",
          symbol: "BTC",
          usd: 74277.73,
          asOf: Date.parse(UPDATED_AT),
          source: "oneclick",
        },
      ],
    });
  });

  it("skips an asset with no usable price", async () => {
    const { fetchImpl } = mock(async () =>
      json([
        { assetId: "a", symbol: "AAA", price: null, priceUpdatedAt: UPDATED_AT },
        { assetId: "b", symbol: "BBB", price: "not-a-number", priceUpdatedAt: UPDATED_AT },
        { assetId: "c", symbol: "CCC", price: 1.25, priceUpdatedAt: UPDATED_AT },
      ]),
    );
    const source = createOneclickSource({ fetchImpl });

    const result = await source.fetchCurrent();

    expect(result.ok && result.value.map((quote) => quote.assetId)).toEqual([
      "c",
    ]);
  });

  it("skips a zero current price", async () => {
    const { fetchImpl } = mock(async () =>
      json([
        { assetId: "a", symbol: "AAA", price: 0, priceUpdatedAt: UPDATED_AT },
        { assetId: "b", symbol: "BBB", price: 1.25, priceUpdatedAt: UPDATED_AT },
      ]),
    );
    const source = createOneclickSource({ fetchImpl });

    const result = await source.fetchCurrent();

    expect(result.ok && result.value.map((quote) => quote.assetId)).toEqual([
      "b",
    ]);
  });

  it("stamps a missing priceUpdatedAt with the fetch time", async () => {
    const { fetchImpl } = mock(async () =>
      json([{ assetId: "a", symbol: "AAA", price: 2 }]),
    );
    const source = createOneclickSource({ now: () => NOW, fetchImpl });

    const result = await source.fetchCurrent();

    expect(result.ok && result.value[0]?.asOf).toBe(NOW);
  });

  it("returns rate-limited with Retry-After", async () => {
    const { fetchImpl } = mock(
      async () =>
        new Response(JSON.stringify({ error: "slow down" }), {
          status: 429,
          headers: { "retry-after": "60" },
        }),
    );
    const source = createOneclickSource({ now: () => NOW, fetchImpl });

    expect(await source.fetchCurrent()).toEqual({
      ok: false,
      error: "rate-limited",
      status: 429,
      retryAfterMs: 60_000,
    });
  });

  it("returns malformed-response for a body that is not a catalogue", async () => {
    const { fetchImpl } = mock(async () => json({ code: 1, msg: "nope" }));
    const source = createOneclickSource({ fetchImpl });

    expect(await source.fetchCurrent()).toEqual({
      ok: false,
      error: "malformed-response",
    });
  });

  it("reuses one catalogue fetch for 60 seconds and then refetches", async () => {
    let clock = NOW;
    const { calls, fetchImpl } = mock(async () =>
      json([{ assetId: "a", symbol: "AAA", price: 1.25, priceUpdatedAt: UPDATED_AT }]),
    );
    const source = createOneclickSource({ now: () => clock, fetchImpl });

    await source.fetchCurrent();
    await source.fetchCurrent();
    expect(calls).toHaveLength(1);

    clock += 60_000;
    await source.fetchCurrent();
    expect(calls).toHaveLength(2);
  });
});
