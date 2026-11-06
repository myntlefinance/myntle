import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSuperBalancesTool,
  type SuperBalancesResult,
} from "./balances";

vi.mock("@/lib/intents/service", () => ({
  getAssets: async () => [
    {
      assetId: "nep141:wrap.near",
      symbol: "wNEAR",
      decimals: 24,
      chain: "near",
      price: 2,
      contractAddress: "wrap.near",
    },
    {
      assetId: "nep141:usdc.near",
      symbol: "USDC",
      decimals: 6,
      chain: "near",
      price: 1,
      contractAddress: "usdc.near",
    },
  ],
}));

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
});
