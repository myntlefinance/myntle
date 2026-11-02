import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/intents/service", () => ({
  getAssets: () =>
    Promise.resolve([
      {
        assetId: "nep141:usdc.near",
        symbol: "usdc",
        decimals: 6,
        chain: "near",
        price: 1,
        contractAddress: "usdc.near",
      },
      {
        assetId: "nep141:wrap.near",
        symbol: "wnear",
        decimals: 24,
        chain: "near",
        price: 5.33,
        contractAddress: "wrap.near",
      },
    ]),
}));

import { GET } from "./route";

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
          priceUsd: 1,
        },
      ],
    });
  });
});
