import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSuperBalancesTool,
  type SuperBalancesResult,
} from "./balances";

const { getAssetsMock, getLivePricesMock } = vi.hoisted(() => ({
  getAssetsMock: vi.fn(),
  getLivePricesMock: vi.fn(),
}));

vi.mock("@/lib/prices/server", () => ({
  getLivePrices: getLivePricesMock,
}));

vi.mock("@/lib/intents/service", () => ({
  getAssets: getAssetsMock,
}));

const CATALOGUE = [
  {
    assetId: "nep141:wrap.near",
    symbol: "wNEAR",
    decimals: 24,
    chain: "near",
    price: 2,
    priceUpdatedAt: 1_762_760_000_000,
    contractAddress: "wrap.near",
  },
  {
    assetId: "nep141:usdc.near",
    symbol: "USDC",
    decimals: 6,
    chain: "near",
    price: 1,
    priceUpdatedAt: 1_762_760_060_000,
    contractAddress: "usdc.near",
  },
];

beforeEach(() => {
  getAssetsMock.mockReset();
  getAssetsMock.mockResolvedValue(CATALOGUE);
  getLivePricesMock.mockReset();
  getLivePricesMock.mockResolvedValue(new Map());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function run(token: string | null): Promise<SuperBalancesResult> {
  const balances = createSuperBalancesTool({ intentsAccessToken: token });
  const result = await balances.execute!(
    {},
    { toolCallId: "call-1", messages: [], context: {} },
  );
  return result as SuperBalancesResult;
}

describe("get_super_balances", () => {
  it("does not call 1Click when no access token was supplied", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await run(null);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "locked",
      needsSuperUnlock: true,
      balances: [],
    });
  });

  it("treats a 401 as locked, not as an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })),
    );

    await expect(run("expired")).resolves.toMatchObject({
      status: "locked",
      needsSuperUnlock: true,
    });
  });

  it("reads only private balances and formats them from base units", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        balances: [
          {
            tokenId: "nep141:wrap.near",
            available: "2000000000000000000000000",
            source: "private",
          },
          {
            tokenId: "nep141:usdc.near",
            available: "1500000",
            source: "private",
          },
          { tokenId: "nep141:zero.near", available: "0", source: "private" },
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await run("live");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toContain("/v0/account/balances");
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer live",
    );

    expect(result).toMatchObject({
      status: "read",
      totalValueUsd: 5.5,
    });
    expect(result.balances).toHaveLength(2);
    expect(result.balances[0]).toMatchObject({
      symbol: "wNEAR",
      amount: "2",
      rawAmount: "2000000000000000000000000",
      priceAsOf: 1_762_760_000_000,
      valueUsd: 4,
    });
    expect(result.balances[1]).toMatchObject({
      symbol: "USDC",
      amount: "1.5",
      valueUsd: 1.5,
    });
    // No address ever leaves the tool.
    expect(result.balances.every((balance) => !("address" in balance))).toBe(
      true,
    );
  });

  it("returns empty when the private ledger has no positive balance", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ balances: [] }),
      })),
    );

    await expect(run("live")).resolves.toMatchObject({
      status: "empty",
      balances: [],
      totalValueUsd: 0,
    });
  });

  it("does not surface an upstream failure body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => ({ message: "internal detail" }),
      })),
    );

    const result = await run("live");
    expect(result).toMatchObject({ status: "error", balances: [] });
    expect(result.message).toBe("The private balance could not be read.");
  });

  it("never echoes an upstream balance source label", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          balances: [
            {
              tokenId: "nep141:usdc.near",
              available: "1500000",
              source: "confidential-account",
            },
          ],
        }),
      })),
    );

    const result = await run("live");

    expect(result.balances[0]).toMatchObject({ source: "private" });
    expect(JSON.stringify(result).toLowerCase()).not.toContain("confidential");
  });

  it("prices a held balance from the live feed over the catalogue", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          balances: [
            {
              tokenId: "nep141:wrap.near",
              available: "2000000000000000000000000",
              source: "private",
            },
          ],
        }),
      })),
    );
    getLivePricesMock.mockResolvedValue(
      new Map([
        [
          "nep141:wrap.near",
          { usd: 3, asOf: 1_762_800_000_000, source: "binance", stale: false },
        ],
      ]),
    );

    const result = await run("live");

    expect(getLivePricesMock).toHaveBeenCalledWith(["nep141:wrap.near"]);
    expect(result.balances[0]).toMatchObject({
      priceUsd: 3,
      valueUsd: 6,
      priceAsOf: 1_762_800_000_000,
    });
    expect(result.totalValueUsd).toBe(6);
  });

  it("does not apply a live quote without catalogue metadata", async () => {
    getAssetsMock.mockRejectedValue(new Error("catalogue down"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          balances: [
            {
              tokenId: "nep141:usdc.near",
              available: "1500000",
              source: "private",
            },
          ],
        }),
      })),
    );
    getLivePricesMock.mockResolvedValue(
      new Map([
        [
          "nep141:usdc.near",
          { usd: 1, asOf: 1_762_800_000_000, source: "binance", stale: false },
        ],
      ]),
    );

    const result = await run("live");

    // No metadata means no live read for that id, and the 6-decimal token
    // must not be priced at the 18-decimal amount.
    expect(getLivePricesMock).toHaveBeenCalledWith([]);
    expect(result.balances[0]).toMatchObject({
      tokenId: "nep141:usdc.near",
      symbol: "UNKNOWN",
      decimals: 18,
    });
    expect(result.balances[0].priceUsd).toBeUndefined();
    expect(result.balances[0].valueUsd).toBeUndefined();
    expect("priceAsOf" in result.balances[0]).toBe(false);
  });

  it("does not write an infinite value from an overflowing quote", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          balances: [
            {
              tokenId: "nep141:usdc.near",
              available: `1${"0".repeat(306)}`,
              source: "private",
            },
          ],
        }),
      })),
    );
    getLivePricesMock.mockResolvedValue(
      new Map([
        [
          "nep141:usdc.near",
          {
            usd: 1e300,
            asOf: 1_762_800_000_000,
            source: "binance",
            stale: false,
          },
        ],
      ]),
    );

    const result = await run("live");

    expect(result.balances[0].priceUsd).toBe(1e300);
    expect(result.balances[0].valueUsd).toBeUndefined();
    expect(Number.isFinite(result.totalValueUsd)).toBe(true);
  });
});
