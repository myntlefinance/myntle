import { describe, expect, it } from "vitest";
import { settlementCardState } from "./approvals";

describe("settlementCardState", () => {
  it("paints terminal database states directly", () => {
    expect(settlementCardState("settled")).toBe("settled");
    expect(settlementCardState("refunded")).toBe("refunded");
    expect(settlementCardState("failed")).toBe("failed");
    expect(settlementCardState("incomplete_deposit")).toBe("failed");
    expect(settlementCardState("needs_reconciliation")).toBe("failed");
  });

  it("leaves live states to the card poll", () => {
    for (const s of ["submitted", "pending", "processing", "authorized"]) {
      expect(settlementCardState(s)).toBeNull();
    }
  });
});
