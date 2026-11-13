import { describe, expect, it } from "vitest";
import { limitOrderTransactionState } from "@/lib/intents/orders";
import { limitOrderLifecycle } from "./limit-order-lifecycle";

/**
 * The workflow's state table is the one the record, the card, and the status
 * tool all read. These tests pin the documented mapping; the pacing itself is
 * two fixed sleeps and needs no clock to verify.
 */

describe("limitOrderLifecycle", () => {
  it("is exported as a durable workflow", () => {
    expect(typeof limitOrderLifecycle).toBe("function");
  });

  it("maps AWAITING_DEPOSIT to submitted", () => {
    expect(
      limitOrderTransactionState({
        fillStatus: "AWAITING_DEPOSIT",
        payoutStatus: "NOT_STARTED",
        isPayoutStatusFinal: false,
      }),
    ).toEqual({ state: "submitted", terminal: false });
  });

  it("maps OPEN to pending", () => {
    expect(
      limitOrderTransactionState({
        fillStatus: "OPEN",
        payoutStatus: "NOT_STARTED",
        isPayoutStatusFinal: false,
      }),
    ).toEqual({ state: "pending", terminal: false });
  });

  it("maps PARTIALLY_FILLED to processing", () => {
    expect(
      limitOrderTransactionState({
        fillStatus: "PARTIALLY_FILLED",
        payoutStatus: "IN_PROGRESS",
        isPayoutStatusFinal: false,
      }),
    ).toEqual({ state: "processing", terminal: false });
  });

  it("maps FILLED with a final payout to settled", () => {
    expect(
      limitOrderTransactionState({
        fillStatus: "FILLED",
        payoutStatus: "COMPLETED",
        isPayoutStatusFinal: true,
      }),
    ).toEqual({ state: "settled", terminal: true });
  });

  it("maps CANCELED with a final refund to refunded", () => {
    expect(
      limitOrderTransactionState({
        fillStatus: "CANCELED",
        payoutStatus: "COMPLETED",
        isPayoutStatusFinal: true,
      }),
    ).toEqual({ state: "refunded", terminal: true });
  });

  it("maps EXPIRED with a final refund to refunded", () => {
    expect(
      limitOrderTransactionState({
        fillStatus: "EXPIRED",
        payoutStatus: "COMPLETED",
        isPayoutStatusFinal: true,
      }),
    ).toEqual({ state: "refunded", terminal: true });
  });

  it("keeps FILLED open until the payout leg is final", () => {
    expect(
      limitOrderTransactionState({
        fillStatus: "FILLED",
        payoutStatus: "IN_PROGRESS",
        isPayoutStatusFinal: false,
      }),
    ).toEqual({ state: "processing", terminal: false });
  });

  it("ends the run on a payout failure", () => {
    expect(
      limitOrderTransactionState({
        fillStatus: "FILLED",
        payoutStatus: "FAILED",
        isPayoutStatusFinal: true,
      }),
    ).toEqual({ state: "failed", terminal: true });
  });
});
