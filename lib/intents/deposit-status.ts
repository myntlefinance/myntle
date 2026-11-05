/**
 * The deposit card's status vocabulary.
 *
 * One 1Click status, one card state, one sentence. The mapping lives here so
 * the route that writes the record, the host that paints a reloaded card, and
 * the card that polls its own record all agree without a second table.
 *
 * The clock never overrules a record. A deposit that 1Click reports as
 * detected or settled keeps that state even after its quote deadline; only a
 * still-pending address can age into Expired.
 */

/** The states a deposit panel can render. */
export type DepositCardState =
  | "waiting"
  | "processing"
  | "settled"
  | "incomplete"
  | "refunded"
  | "failed"
  | "expired";

/** The reader-facing phase, including the pre-address state. */
export type DepositPhase =
  | "awaiting"
  | "waiting"
  | "detected"
  | "settled"
  | "incomplete"
  | "refunded"
  | "failed"
  | "expired";

/** A database state the refresh route may write. */
export type DepositRecordState =
  | "pending"
  | "processing"
  | "confirming"
  | "settled"
  | "refunded"
  | "failed"
  | "incomplete_deposit"
  | "expired";

const TERMINAL = new Set([
  "settled",
  "refunded",
  "failed",
  "incomplete_deposit",
  "expired",
]);

/** The stored expiry, or null when the record never carried one. */
export function depositExpiry(expiresAt: string | null | undefined): number {
  if (!expiresAt) return Number.NaN;
  return Date.parse(expiresAt);
}

/** True when the address's own quote deadline has passed. */
export function depositExpired(
  expiresAt: string | null | undefined,
  now: number,
): boolean {
  const deadline = depositExpiry(expiresAt);
  return Number.isFinite(deadline) && deadline <= now;
}

/** A record state that can still change. */
export function isRefreshableDepositRecord(state: string): boolean {
  return !TERMINAL.has(state);
}

/**
 * The state a reloaded or polled record paints.
 *
 * `needs_reconciliation` is deliberately not a failure: the workflow's
 * 60-minute window is a bound on polling, not a settlement. While the address
 * is still inside its own quote deadline the deposit can still arrive, so the
 * card keeps waiting until the stored expiry says otherwise.
 */
export function depositCardStateForRecord(
  state: string,
  expiresAt: string | null | undefined,
  now: number,
): DepositCardState {
  switch (state) {
    case "settled":
      return "settled";
    case "refunded":
      return "refunded";
    case "incomplete_deposit":
      return "incomplete";
    case "failed":
      return "failed";
    case "expired":
      return "expired";
    case "processing":
    case "confirming":
      return "processing";
    case "needs_reconciliation":
    case "submitted":
    case "pending":
    case "authorized":
    case "quoted":
    case "draft":
    case "awaiting_approval":
    default:
      return depositExpired(expiresAt, now) ? "expired" : "waiting";
  }
}

/**
 * The state the refresh route writes for one 1Click status.
 *
 * This is the single place the raw PENDING_DEPOSIT / KNOWN_DEPOSIT_TX /
 * PROCESSING / SUCCESS vocabulary is translated. A pending address past its
 * stored expiry is `expired`; the same address before the deadline restores
 * `pending`, which is what repairs a workflow that timed out early.
 */
export function depositTransitionForStatus(
  status: string,
  expiresAt: string | null | undefined,
  now: number,
): { state: DepositRecordState; phase: DepositPhase } {
  switch (status) {
    case "SUCCESS":
      return { state: "settled", phase: "settled" };
    case "FAILED":
      return { state: "failed", phase: "failed" };
    case "REFUNDED":
      return { state: "refunded", phase: "refunded" };
    case "INCOMPLETE_DEPOSIT":
      return { state: "incomplete_deposit", phase: "incomplete" };
    case "KNOWN_DEPOSIT_TX":
      return { state: "confirming", phase: "detected" };
    case "PROCESSING":
      return { state: "processing", phase: "detected" };
    case "PENDING_DEPOSIT":
    default:
      return depositExpired(expiresAt, now)
        ? { state: "expired", phase: "expired" }
        : { state: "pending", phase: "waiting" };
  }
}

const MESSAGE: Record<
  Exclude<DepositPhase, "awaiting" | "waiting">,
  string
> = {
  detected: "Deposit detected. Processing…",
  settled: "Success. Your deposit was detected and credited to your account.",
  incomplete: "The deposit was below the required amount.",
  refunded: "The deposit was refunded.",
  failed: "The deposit did not settle. The record has the details.",
  expired: "Expired. Please generate a fresh deposit address.",
};

/** The one sentence a phase adds, or nothing while the address waits. */
export function depositStatusMessage(phase: DepositPhase): string | null {
  if (phase === "awaiting" || phase === "waiting") return null;
  return MESSAGE[phase];
}

/** The card state rendered by the phase the record produced. */
export function depositPhaseForCardState(
  state: DepositCardState,
  hasAddress: boolean,
): DepositPhase {
  if (state === "settled") return "settled";
  if (state === "refunded") return "refunded";
  if (state === "incomplete") return "incomplete";
  if (state === "failed") return "failed";
  if (state === "expired") return "expired";
  if (state === "processing") return "detected";
  return hasAddress ? "waiting" : "awaiting";
}

/** A terminal phase offers a fresh address; waiting and processing do not. */
export function needsFreshDepositAddress(phase: DepositPhase): boolean {
  return (
    phase === "expired" ||
    phase === "failed" ||
    phase === "refunded" ||
    phase === "incomplete"
  );
}
