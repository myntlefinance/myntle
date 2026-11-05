import { describe, expect, it } from "vitest";
import { settledAmountOut } from "./settlement-amount";

describe("settledAmountOut", () => {
  it("uses the status snapshot when it reports an amount", () => {
    expect(
      settledAmountOut({
        mode: "confidential-withdrawal",
        snapshotAmountOut: "0.4894",
        expectedOut: "0.4894",
      }),
    ).toBe("0.4894");
  });

  it("never reports the quote's expected amount for a withdrawal", () => {
    // The promise is not the settlement. A withdrawal with no status amount
    // reports no number rather than the figure the quote expected.
    expect(
      settledAmountOut({
        mode: "confidential-withdrawal",
        snapshotAmountOut: undefined,
        expectedOut: "0.4894",
      }),
    ).toBe("");
    expect(
      settledAmountOut({
        mode: "confidential-withdrawal",
        snapshotAmountOut: "   ",
        expectedOut: "0.4894",
      }),
    ).toBe("");
  });

  it("keeps the quote fallback for the other modes", () => {
    expect(
      settledAmountOut({
        mode: "confidential-intents",
        snapshotAmountOut: undefined,
        expectedOut: "121013",
      }),
    ).toBe("121013");
    expect(
      settledAmountOut({
        mode: undefined,
        snapshotAmountOut: undefined,
        expectedOut: "100",
      }),
    ).toBe("100");
    expect(
      settledAmountOut({
        mode: "confidential-external",
        snapshotAmountOut: undefined,
        expectedOut: undefined,
      }),
    ).toBe("");
  });

  it("prefers the snapshot over the expectation", () => {
    expect(
      settledAmountOut({
        mode: "confidential-intents",
        snapshotAmountOut: "99.5",
        expectedOut: "100",
      }),
    ).toBe("99.5");
  });
});
