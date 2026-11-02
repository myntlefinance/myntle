import { describe, expect, it } from "vitest";
import {
  APPROVAL_WINDOW_MS,
  buildTradeApprovalMessage,
  isApprovalWindowValid,
} from "./approval-message";

const PARAMS = {
  fromAssetId: "nep141:usdc.near",
  toAssetId: "nep141:wrap.near",
  amount: "14000000",
  recipient: "0x3259",
  slippageBps: 100,
  minAmountOut: "13850000",
  expiresAt: "2026-10-29T00:30:00.000Z",
  requestedAt: "2026-10-29T00:00:00.000Z",
};

describe("approval window", () => {
  it("lasts five minutes", () => {
    expect(APPROVAL_WINDOW_MS).toBe(5 * 60_000);
  });

  it("accepts a fresh request", () => {
    const now = Date.parse("2026-10-29T00:04:59.000Z");
    expect(isApprovalWindowValid("2026-10-29T00:00:00.000Z", now)).toBe(true);
  });

  it("rejects a request past the window", () => {
    const now = Date.parse("2026-10-29T00:05:01.000Z");
    expect(isApprovalWindowValid("2026-10-29T00:00:00.000Z", now)).toBe(false);
  });

  it("rejects garbage timestamps", () => {
    expect(isApprovalWindowValid("not-a-time")).toBe(false);
    expect(isApprovalWindowValid("")).toBe(false);
  });

  it("binds the request time into the signed message", () => {
    const message = buildTradeApprovalMessage(PARAMS);
    expect(message).toContain("Requested: 2026-10-29T00:00:00.000Z");
    const moved = buildTradeApprovalMessage({
      ...PARAMS,
      requestedAt: "2026-10-29T00:01:00.000Z",
    });
    expect(moved).not.toBe(message);
  });
});
