import { describe, expect, it } from "vitest";
import {
  DEPOSIT_FUNDING_MARGIN_MS,
  FRESH_DEPOSIT_PROMPT,
  depositCardStateForRecord,
  depositExpired,
  depositFundingDeadline,
  depositPhaseForCardState,
  depositRecordFresh,
  depositStatusMessage,
  depositTransitionForStatus,
  isRefreshableDepositRecord,
  needsFreshDepositAddress,
} from "./deposit-status";

/**
 * The deposit status table.
 *
 * The card, the host, and the refresh route all read these functions, so the
 * mapping is tested once here rather than three times through React.
 */

const VALID = "2099-01-01T00:00:00.000Z";
const PAST = "2020-01-01T00:00:00.000Z";
const NOW = Date.parse("2026-11-03T12:00:00.000Z");

describe("depositCardStateForRecord", () => {
  it("maps every one-click record state to its reader-facing state", () => {
    expect(depositCardStateForRecord("pending", VALID, NOW)).toBe("waiting");
    expect(depositCardStateForRecord("submitted", VALID, NOW)).toBe("waiting");
    expect(depositCardStateForRecord("processing", VALID, NOW)).toBe(
      "processing",
    );
    expect(depositCardStateForRecord("confirming", VALID, NOW)).toBe(
      "processing",
    );
    expect(depositCardStateForRecord("settled", VALID, NOW)).toBe("settled");
    expect(depositCardStateForRecord("refunded", VALID, NOW)).toBe("refunded");
    expect(depositCardStateForRecord("incomplete_deposit", VALID, NOW)).toBe(
      "incomplete",
    );
    expect(depositCardStateForRecord("failed", VALID, NOW)).toBe("failed");
    expect(depositCardStateForRecord("expired", VALID, NOW)).toBe("expired");
  });

  it("ages a pending address out only after its own deadline", () => {
    expect(depositCardStateForRecord("pending", PAST, NOW)).toBe("expired");
    expect(depositCardStateForRecord("submitted", PAST, NOW)).toBe("expired");
    expect(depositCardStateForRecord("needs_reconciliation", PAST, NOW)).toBe(
      "expired",
    );
    expect(depositCardStateForRecord("pending", null, NOW)).toBe("waiting");
  });

  it("never lets the clock overrule a detected or settled deposit", () => {
    // The status wins: a deposit 1Click saw cannot be aged into Expired.
    expect(depositCardStateForRecord("processing", PAST, NOW)).toBe(
      "processing",
    );
    expect(depositCardStateForRecord("confirming", PAST, NOW)).toBe(
      "processing",
    );
    expect(depositCardStateForRecord("settled", PAST, NOW)).toBe("settled");
    expect(depositCardStateForRecord("refunded", PAST, NOW)).toBe("refunded");
    expect(depositCardStateForRecord("incomplete_deposit", PAST, NOW)).toBe(
      "incomplete",
    );
  });

  it("keeps a timed-out workflow waiting while the quote is valid", () => {
    expect(depositCardStateForRecord("needs_reconciliation", VALID, NOW)).toBe(
      "waiting",
    );
  });
});

describe("depositTransitionForStatus", () => {
  it("restores a pending record from PENDING_DEPOSIT while the quote is valid", () => {
    expect(depositTransitionForStatus("PENDING_DEPOSIT", VALID, NOW)).toEqual({
      state: "pending",
      phase: "waiting",
    });
  });

  it("writes Expired when PENDING_DEPOSIT arrives past the stored deadline", () => {
    expect(depositTransitionForStatus("PENDING_DEPOSIT", PAST, NOW)).toEqual({
      state: "expired",
      phase: "expired",
    });
  });

  it("maps a detected deposit to a live record", () => {
    expect(depositTransitionForStatus("KNOWN_DEPOSIT_TX", VALID, NOW)).toEqual({
      state: "confirming",
      phase: "detected",
    });
    expect(depositTransitionForStatus("PROCESSING", VALID, NOW)).toEqual({
      state: "processing",
      phase: "detected",
    });
  });

  it("maps every terminal status without the clock overriding it", () => {
    expect(depositTransitionForStatus("SUCCESS", PAST, NOW)).toEqual({
      state: "settled",
      phase: "settled",
    });
    expect(depositTransitionForStatus("REFUNDED", PAST, NOW)).toEqual({
      state: "refunded",
      phase: "refunded",
    });
    expect(depositTransitionForStatus("INCOMPLETE_DEPOSIT", PAST, NOW)).toEqual(
      { state: "incomplete_deposit", phase: "incomplete" },
    );
    expect(depositTransitionForStatus("FAILED", PAST, NOW)).toEqual({
      state: "failed",
      phase: "failed",
    });
  });
});

describe("deposit copy", () => {
  it("says exactly what the status means", () => {
    expect(depositStatusMessage("waiting")).toBeNull();
    expect(depositStatusMessage("awaiting")).toBeNull();
    expect(depositStatusMessage("detected")).toBe(
      "Deposit detected. Processing…",
    );
    expect(depositStatusMessage("settled")).toBe(
      "Success. Your deposit was detected and credited to your account.",
    );
    expect(depositStatusMessage("incomplete")).toBe(
      "The deposit was below the required amount.",
    );
    expect(depositStatusMessage("refunded")).toBe("The deposit was refunded.");
    expect(depositStatusMessage("failed")).toBe(
      "The deposit did not settle. The record has the details.",
    );
    expect(depositStatusMessage("expired")).toBe("Expired.");
    expect(FRESH_DEPOSIT_PROMPT).toBe(
      "Please generate a fresh deposit address.",
    );
  });

  it("derives the phase from the card state", () => {
    expect(depositPhaseForCardState("waiting", false)).toBe("awaiting");
    expect(depositPhaseForCardState("waiting", true)).toBe("waiting");
    expect(depositPhaseForCardState("processing", true)).toBe("detected");
    expect(depositPhaseForCardState("settled", true)).toBe("settled");
    expect(depositPhaseForCardState("incomplete", true)).toBe("incomplete");
    expect(depositPhaseForCardState("refunded", true)).toBe("refunded");
    expect(depositPhaseForCardState("failed", true)).toBe("failed");
    expect(depositPhaseForCardState("expired", true)).toBe("expired");
  });

  it("offers a fresh address only on a terminal phase", () => {
    for (const phase of [
      "expired",
      "failed",
      "refunded",
      "incomplete",
    ] as const) {
      expect(needsFreshDepositAddress(phase)).toBe(true);
    }
    for (const phase of ["awaiting", "waiting", "detected", "settled"] as const) {
      expect(needsFreshDepositAddress(phase)).toBe(false);
    }
  });
});

describe("depositExpiry", () => {
  it("only reports a real stored deadline", () => {
    expect(depositExpired(VALID, NOW)).toBe(false);
    expect(depositExpired(PAST, NOW)).toBe(true);
    expect(depositExpired(null, NOW)).toBe(false);
    expect(depositExpired("not-a-date", NOW)).toBe(false);
  });

  it("closes the funding window fifteen minutes before the quote deadline", () => {
    const thirtyMinutesOut = "2026-11-03T12:30:00.000Z";
    expect(DEPOSIT_FUNDING_MARGIN_MS).toBe(15 * 60_000);
    expect(depositFundingDeadline(thirtyMinutesOut)).toBe(
      Date.parse("2026-11-03T12:15:00.000Z"),
    );
    // 20 minutes before the quote: still inside the funding window.
    const twentyBefore = Date.parse("2026-11-03T12:10:00.000Z");
    expect(depositExpired(thirtyMinutesOut, twentyBefore)).toBe(false);
    // 10 minutes before the quote: the fifteen-minute margin has closed it.
    const tenBefore = Date.parse("2026-11-03T12:20:00.000Z");
    expect(depositExpired(thirtyMinutesOut, tenBefore)).toBe(true);
    expect(
      depositTransitionForStatus(
        "PENDING_DEPOSIT",
        thirtyMinutesOut,
        tenBefore,
      ),
    ).toEqual({
      state: "expired",
      phase: "expired",
    });
  });

  it("treats every terminal record as no longer refreshable", () => {
    for (const state of [
      "settled",
      "refunded",
      "failed",
      "incomplete_deposit",
      "expired",
    ]) {
      expect(isRefreshableDepositRecord(state)).toBe(false);
    }
    for (const state of [
      "pending",
      "processing",
      "confirming",
      "submitted",
      "needs_reconciliation",
    ]) {
      expect(isRefreshableDepositRecord(state)).toBe(true);
    }
  });
});

describe("depositRecordFresh", () => {
  it("trusts only a record written inside the short window", () => {
    expect(depositRecordFresh("2026-11-03T11:59:58.000Z", NOW)).toBe(true);
    expect(depositRecordFresh("2026-11-03T11:59:50.000Z", NOW)).toBe(false);
    expect(depositRecordFresh("2026-11-03T12:00:10.000Z", NOW)).toBe(false);
    expect(depositRecordFresh(null, NOW)).toBe(false);
    expect(depositRecordFresh("not-a-date", NOW)).toBe(false);
  });
});
