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

/**
 * How long a verified pending record is trusted before the card rechecks it.
 *
 * A pending row is only evidence that the address was still waiting when
 * 1Click was last read. Past this window the card must ask again before it
 * uses the waiting vocabulary.
 */
export const DEPOSIT_STATUS_TRUST_MS = 5_000;

/** True when the status was checked inside the trust window. */
export function depositRecordFresh(
  checkedAt: string | null | undefined,
  now: number,
): boolean {
  if (!checkedAt) return false;
  const checked = Date.parse(checkedAt);
  if (!Number.isFinite(checked)) return false;
  const age = now - checked;
  return age >= 0 && age < DEPOSIT_STATUS_TRUST_MS;
}

/**
 * How long before the quote deadline the address stops inviting funding.
 *
 * A deposit sent in the last minutes of the quote can be broadcast before the
 * deadline and confirmed after it. Reserving fifteen minutes protects the
 * sender on chains with slow confirmation. The address may still be accepted
 * by 1Click until its real deadline; the interface stops telling anyone to
 * fund it earlier than that.
 */
export const DEPOSIT_FUNDING_MARGIN_MS = 15 * 60_000;

/**
 * How long after the real quote deadline a late deposit may still be detected.
 *
 * The workflow keeps polling, and the card keeps reading the record, so a
 * transfer broadcast inside the funding window can still settle after the
 * interface has stopped inviting new deposits. This is a grace read, not a
 * second funding window.
 */
export const DEPOSIT_DETECTION_GRACE_MS = 2 * 60 * 60_000;

/** The stored expiry, or null when the record never carried one. */
export function depositExpiry(expiresAt: string | null | undefined): number {
  if (!expiresAt) return Number.NaN;
  return Date.parse(expiresAt);
}

/** The last moment the card invites a new deposit, fifteen minutes early. */
export function depositFundingDeadline(
  expiresAt: string | null | undefined,
): number {
  const deadline = depositExpiry(expiresAt);
  return Number.isFinite(deadline)
    ? deadline - DEPOSIT_FUNDING_MARGIN_MS
    : Number.NaN;
}

/**
 * True when the funding window has closed.
 *
 * This is deliberately earlier than the quote deadline: the product stops
 * inviting deposits while there is still time for a slow chain to confirm.
 */
export function depositExpired(
  expiresAt: string | null | undefined,
  now: number,
): boolean {
  const deadline = depositFundingDeadline(expiresAt);
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
 * polling window is a bound on checks, not a settlement. While the address
 * is still inside its funding window the deposit can still arrive, so the
 * card keeps waiting until the stored expiry says otherwise.
 *
 * `depositSent` is the sender's own funding hash, registered after a wallet
 * transfer. The transaction row is written when the address is minted and
 * only moves to `confirming` once 1Click has seen the transfer, so a record
 * that still says `submitted` after a send does not mean "waiting for funds".
 * Painting it as waiting is what made a funded deposit drop back to its
 * address and offer a second transfer, so the registered hash outranks the
 * stale record state until the settlement reports something terminal.
 */
export function depositCardStateForRecord(
  state: string,
  expiresAt: string | null | undefined,
  now: number,
  depositSent = false,
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
      return depositExpired(expiresAt, now) ? "expired" : "waiting";
    case "submitted":
    case "pending":
    case "authorized":
    case "quoted":
    case "draft":
    case "awaiting_approval":
    default:
      if (depositSent) return "processing";
      return depositExpired(expiresAt, now) ? "expired" : "waiting";
  }
}

/**
 * The state the refresh route writes for one 1Click status.
 *
 * This is the single place the raw PENDING_DEPOSIT / KNOWN_DEPOSIT_TX /
 * PROCESSING / SUCCESS vocabulary is translated. A pending address past its
 * funding window is `expired`; the same address before the window closes
 * restores `pending`, which is what repairs a workflow that timed out early.
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

/**
 * The sentence a dead deposit address offers in place of the address.
 *
 * The card draws it as the action after its status sentence — "Expired.
 * Please generate a fresh deposit address." — and a click sends the same
 * words as a chat prompt. A fresh address is a new request through the
 * conversation that issued the old one, never a second mint behind the
 * reader's back, and the dead address leaves the card the moment it can no
 * longer be funded.
 */
export const FRESH_DEPOSIT_PROMPT = "Please generate a fresh deposit address.";

const MESSAGE: Record<
  Exclude<DepositPhase, "awaiting" | "waiting">,
  string
> = {
  detected: "Deposit detected. Processing…",
  settled: "Success. Your deposit was detected and credited to your account.",
  incomplete: "The deposit was below the required amount.",
  refunded: "The deposit was refunded.",
  failed: "The deposit did not settle. The record has the details.",
  // The invitation to replace the address is the action the card draws
  // beside this sentence, not part of it: the same words are sent as the
  // prompt, and a surface with no composer says only what happened.
  expired: "Expired.",
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
