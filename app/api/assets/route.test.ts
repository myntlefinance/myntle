import { beforeEach, describe, expect, it, vi } from "vitest";

const { getLivePricesMock } = vi.hoisted(() => ({
  getLivePricesMock: vi.fn(),
}));

vi.mock("@/lib/prices/server", () => ({
  getLivePrices: getLivePricesMock,
}));

vi.mock("@/lib/intents/service", () => ({
  getAssets: () =>
    Promise.resolve([
      {
        assetId: "nep141:usdc.near",
        symbol: "usdc",
        decimals: 6,
        chain: "near",
        price: 1,
        priceUpdatedAt: 1762760000000,
        contractAddress: "usdc.near",
      },
      {
        assetId: "nep141:wrap.near",
        symbol: "wnear",
        decimals: 24,
        chain: "near",
        price: 5.33,
        priceUpdatedAt: 1762760060000,
        contractAddress: "wrap.near",
      },
      {
        assetId: "nep141:bsc-native-near",
        symbol: "near",
        decimals: 18,
        chain: "bsc",
        price: 5.2,
        priceUpdatedAt: 1762760120000,
        contractAddress: "0xbsc-near",
      },
    ]),
}));

import { GET } from "./route";
import { pickSymbolAssetForHistory } from "@/components/app/useAssetPrice";

beforeEach(() => {
  getLivePricesMock.mockReset();
  getLivePricesMock.mockResolvedValue(new Map());
});

function get(url: string) {
  return GET(new Request(url));
}

describe("/api/assets", () => {
  it("returns an empty list without ids", async () => {
    const res = await get("http://x/api/assets");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ assets: [] });
  });

  it("resolves known ids with readable metadata", async () => {
    const res = await get("http://x/api/assets?ids=nep141:usdc.near,unknown-id");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      assets: [
        {
          assetId: "nep141:usdc.near",
          symbol: "USDC",
          chain: "near",
          decimals: 6,
          priceUsd: 1,
          contractAddress: "usdc.near",
          priceAsOf: 1762760000000,
        },
      ],
    });
  });

  it("resolves tickers so an inline chip can price itself", async () => {
    const res = await get("http://x/api/assets?symbols=usdc,WNEAR");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      assets: [
        {
          assetId: "nep141:usdc.near",
          symbol: "USDC",
          chain: "near",
          decimals: 6,
          priceUsd: 1,
          contractAddress: "usdc.near",
          priceAsOf: 1762760000000,
        },
        {
          assetId: "nep141:wrap.near",
          symbol: "WNEAR",
          chain: "near",
          decimals: 24,
          priceUsd: 5.33,
          contractAddress: "wrap.near",
          priceAsOf: 1762760060000,
        },
      ],
    });
  });

  it("includes the near wNEAR row when NEAR is requested", async () => {
    const res = await get("http://x/api/assets?symbols=NEAR");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      assets: Array<{
        assetId: string;
        symbol: string;
        chain: string;
      }>;
    };

    expect(body.assets.map((asset) => asset.assetId)).toEqual([
      "nep141:wrap.near",
      "nep141:bsc-native-near",
    ]);
    // The card names the chain, and the chain-matched row is the real NEAR.
    expect(pickSymbolAssetForHistory(body.assets, "near")?.assetId).toBe(
      "nep141:wrap.near",
    );
  });

  it("uses a live quote and keeps the catalogue price as the fallback", async () => {
    getLivePricesMock.mockResolvedValue(
      new Map([
        [
          "nep141:usdc.near",
          {
            usd: 0.9998,
            asOf: 1_762_800_000_000,
            source: "binance",
            stale: false,
          },
        ],
      ]),
    );

    const res = await get(
      "http://x/api/assets?ids=nep141:usdc.near,nep141:wrap.near",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      assets: Array<{ assetId: string; priceUsd: number; priceAsOf: number }>;
    };

    expect(getLivePricesMock).toHaveBeenCalledWith([
      "nep141:usdc.near",
      "nep141:wrap.near",
    ]);
    expect(body.assets[0]).toMatchObject({
      priceUsd: 0.9998,
      priceAsOf: 1_762_800_000_000,
    });
    expect(body.assets[1]).toMatchObject({
      priceUsd: 5.33,
      priceAsOf: 1762760060000,
    });
  });
});
