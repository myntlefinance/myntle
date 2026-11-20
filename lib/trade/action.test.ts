import { describe, expect, it } from "vitest";
import {
  actionTitle,
  failureSentence,
  parseTradeAction,
  rejectionSentence,
  settledSentence,
} from "./action";

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

  it("names what was refused in the sentence's own grammar", () => {
    expect(rejectionSentence("swap")).toBe("You rejected the swap.");
    expect(rejectionSentence("deposit")).toBe("You rejected the deposit.");
    expect(rejectionSentence("bridge")).toBe("You rejected the bridge.");
    expect(rejectionSentence("withdraw")).toBe("You rejected the withdrawal.");
    expect(rejectionSentence("trade")).toBe("You rejected the trade.");
    expect(rejectionSentence("limit")).toBe("You rejected the limit order.");
    expect(rejectionSentence("earn")).toBe("You rejected the deposit.");
  });

  it("says what finished once the action settles", () => {
    expect(settledSentence("swap")).toBe("Your swap is complete.");
    expect(settledSentence("deposit")).toBe("Your deposit is complete.");
    expect(settledSentence("bridge")).toBe("Your bridge is complete.");
    expect(settledSentence("withdraw")).toBe("Your withdrawal is complete.");
    expect(settledSentence("trade")).toBe("Your trade is complete.");
    expect(settledSentence("limit")).toBe("Your limit order filled.");
    expect(settledSentence("earn")).toBe("Your deposit is complete.");
  });

  it("names the action that failed", () => {
    expect(failureSentence("swap")).toBe("Your swap failed. Please try again.");
    expect(failureSentence("withdraw")).toBe(
      "Your withdrawal failed. Please try again.",
    );
    expect(failureSentence("limit")).toBe(
      "Your limit order failed. Please try again.",
    );
  });
});
