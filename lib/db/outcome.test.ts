import { describe, expect, it } from "vitest";
import { outcomeNeedsWrite } from "./outcome";

describe("outcomeNeedsWrite", () => {
  it("writes a missing outcome", () => {
    expect(outcomeNeedsWrite(null, { amountOut: "1.2" })).toBe(true);
    expect(outcomeNeedsWrite({}, { amountOut: "1.2" })).toBe(true);
  });

  it("skips an identical outcome", () => {
    expect(
      outcomeNeedsWrite(
        { amountOut: "1.2", explorerUrls: ["https://a", "https://b"] },
        { amountOut: "1.2", explorerUrls: ["https://b", "https://a"] },
      ),
    ).toBe(false);
  });

  it("writes a changed amount", () => {
    expect(
      outcomeNeedsWrite({ amountOut: "1.2" }, { amountOut: "1.3" }),
    ).toBe(true);
  });

  it("treats reordered explorer URLs as the same set", () => {
    expect(
      outcomeNeedsWrite(
        { explorerUrls: ["https://a", "https://b"] },
        { explorerUrls: ["https://b", "https://a"] },
      ),
    ).toBe(false);
  });

  it("writes a different explorer URL set", () => {
    expect(
      outcomeNeedsWrite(
        { explorerUrls: ["https://a", "https://b"] },
        { explorerUrls: ["https://a", "https://c"] },
      ),
    ).toBe(true);
  });

  it("ignores object key order in nested values", () => {
    expect(
      outcomeNeedsWrite(
        { detail: { chain: "arb", hash: "0x1" } },
        { detail: { hash: "0x1", chain: "arb" } },
      ),
    ).toBe(false);
  });

  it("writes a changed nested value", () => {
    expect(
      outcomeNeedsWrite(
        { detail: { chain: "arb", hash: "0x1" } },
        { detail: { chain: "arb", hash: "0x2" } },
      ),
    ).toBe(true);
  });

  it("leaves extra stored keys alone", () => {
    expect(
      outcomeNeedsWrite(
        { amountOut: "1.2", futureField: true },
        { amountOut: "1.2" },
      ),
    ).toBe(false);
  });

  it("skips a missing next outcome", () => {
    expect(outcomeNeedsWrite({ amountOut: "1.2" }, null)).toBe(false);
    expect(outcomeNeedsWrite({ amountOut: "1.2" }, undefined)).toBe(false);
  });
});
