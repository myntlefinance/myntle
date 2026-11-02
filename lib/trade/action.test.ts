import { describe, expect, it } from "vitest";
import { actionTitle, parseTradeAction } from "./action";

describe("trade action", () => {
  it("defaults unknown values to swap", () => {
    expect(parseTradeAction(undefined)).toBe("swap");
    expect(parseTradeAction("lend")).toBe("swap");
    expect(parseTradeAction("deposit")).toBe("deposit");
    expect(parseTradeAction("bridge")).toBe("bridge");
    expect(parseTradeAction("withdraw")).toBe("withdraw");
    expect(parseTradeAction("trade")).toBe("trade");
  });

  it("maps the legacy withdrawal value", () => {
    expect(parseTradeAction("withdrawal")).toBe("withdraw");
  });

  it("titles each action with a single word", () => {
    expect(actionTitle("deposit")).toBe("Deposit");
    expect(actionTitle("swap")).toBe("Swap");
    expect(actionTitle("bridge")).toBe("Bridge");
    expect(actionTitle("withdraw")).toBe("Withdraw");
    expect(actionTitle("trade")).toBe("Trade");
  });
});
