import { describe, expect, it } from "vitest";
import { isApprovalClaimMatchingQuote } from "./approval-check";

const STORED = {
  fromAssetId: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near",
  toAssetId: "nep141:wrap.near",
  amount: "1000000",
  recipient: "0x3259",
  refundTo: "0x3259",
  slippageBps: 100,
  minAmountOutRaw: "3970777",
  expiresAt: "2026-11-04T12:30:00.000Z",
};

const CLAIM = {
  fromAssetId: STORED.fromAssetId,
  toAssetId: STORED.toAssetId,
  amount: STORED.amount,
  recipient: STORED.recipient,
  refundTo: STORED.refundTo,
  slippageBps: STORED.slippageBps,
  minAmountOut: STORED.minAmountOutRaw,
  expiresAt: STORED.expiresAt,
};

describe("approval claim check", () => {
  it("accepts the exact priced parameters", () => {
    expect(isApprovalClaimMatchingQuote(CLAIM, STORED)).toBe(true);
  });

  it.each([
    ["moved recipient", { ...CLAIM, recipient: "0x9999" }],
    ["moved refund", { ...CLAIM, refundTo: "0x9999" }],
    ["moved amount", { ...CLAIM, amount: "2000000" }],
    ["moved minimum", { ...CLAIM, minAmountOut: "9999999" }],
    ["moved expiry", { ...CLAIM, expiresAt: "2026-11-04T13:30:00.000Z" }],
    ["moved slippage", { ...CLAIM, slippageBps: 300 }],
    ["moved pair", { ...CLAIM, toAssetId: "nep141:wrap.near".replace("wrap", "wrap2") }],
  ])("rejects a claim with %s", (_name, claim) => {
    expect(isApprovalClaimMatchingQuote(claim, STORED)).toBe(false);
  });
});
