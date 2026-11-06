import { describe, it, expect } from "vitest";
import { pickSymbolPrice } from "@/components/app/useAssetPrice";

const assets = [
  { assetId: "a", symbol: "USDC", chain: "ethereum", priceUsd: 1 },
  { assetId: "b", symbol: "USDC", chain: "near", priceUsd: 1.001 },
  { assetId: "c", symbol: "USDC", chain: "base" },
];

describe("pickSymbolPrice", () => {
  it("prefers the chain the card is showing", () => {
    expect(pickSymbolPrice(assets, "near")).toBe(1.001);
  });

  it("falls back to the first priced match", () => {
    expect(pickSymbolPrice(assets, "arb")).toBe(1);
    expect(pickSymbolPrice(assets)).toBe(1);
  });

  it("returns undefined when no match carries a price", () => {
    expect(
      pickSymbolPrice([{ assetId: "d", symbol: "XYZ", chain: "near" }]),
    ).toBeUndefined();
  });
});
