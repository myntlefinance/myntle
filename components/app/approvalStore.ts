/**
 * Paint caches for decided cards.
 *
 * A decision is a database row (`tool_approvals`) and a settlement is a
 * transaction row; those are the record. This module only holds the small
 * pieces a card already knew so a reload paints the right thing on the first
 * frame instead of flashing a spinner until the server read lands — the
 * transaction it polled, and the terminal state it last saw.
 *
 * Nothing here decides whether a card may be acted on. A refusal is never
 * cached: it is written to the server by `/api/approvals/deny`, which is the
 * only reason it survives a different browser.
 */

export type ApprovalTx = {
  transactionId: string;
  depositAddress: string;
  /** Present for a limit order, so its Cancel control survives a reload. */
  orderId?: string;
};

const TX_KEY = "myntle.approval-tx.v1";
const OUTCOME_KEY = "myntle.approval-outcome.v1";
const MAX_ENTRIES = 200;

export type ApprovalOutcome =
  | "settled"
  | "refunded"
  | "incomplete"
  | "expired"
  | "failed";

const tx = new Map<string, ApprovalTx>();
const outcome = new Map<string, ApprovalOutcome>();
let hydrated = false;

function storage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
    const global = globalThis as { localStorage?: Storage };
    return global.localStorage ?? null;
  } catch {
    return null;
  }
}

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  const store = storage();
  if (!store) return;
  try {
    const rawTx = store.getItem(TX_KEY);
    if (rawTx) {
      const parsed = JSON.parse(rawTx) as Record<string, ApprovalTx>;
      for (const [id, record] of Object.entries(parsed).slice(-MAX_ENTRIES)) {
        if (
          record &&
          typeof record.transactionId === "string" &&
          typeof record.depositAddress === "string"
        ) {
          tx.set(id, record);
        }
      }
    }
    const rawOutcome = store.getItem(OUTCOME_KEY);
    if (rawOutcome) {
      const parsed = JSON.parse(rawOutcome) as Record<string, ApprovalOutcome>;
      for (const [id, value] of Object.entries(parsed).slice(-MAX_ENTRIES)) {
        if (value === "settled" || value === "refunded" || value === "failed" || value === "incomplete" || value === "expired") {
          outcome.set(id, value);
        }
      }
    }
  } catch {
    // Corrupt storage never breaks the card; memory still works.
  }
}

function persist(): void {
  const store = storage();
  if (!store) return;
  try {
    const txEntries = [...tx.entries()].slice(-MAX_ENTRIES);
    store.setItem(TX_KEY, JSON.stringify(Object.fromEntries(txEntries)));
    const outcomeEntries = [...outcome.entries()].slice(-MAX_ENTRIES);
    store.setItem(OUTCOME_KEY, JSON.stringify(Object.fromEntries(outcomeEntries)));
  } catch {
    // Quota or privacy mode: memory still works for the session.
  }
}

/** Resets all records. Only used by tests. */
export function resetApprovalStore(): void {
  tx.clear();
  outcome.clear();
  hydrated = false;
}

export function rememberApprovalTx(approvalId: string, record: ApprovalTx): void {
  hydrate();
  if (tx.size >= MAX_ENTRIES) {
    const oldest = tx.keys().next();
    if (!oldest.done) tx.delete(oldest.value);
  }
  tx.set(approvalId, record);
  persist();
}

export function getApprovalTx(approvalId: string): ApprovalTx | undefined {
  hydrate();
  return tx.get(approvalId);
}

/**
 * Records a terminal settlement outcome so a reload paints it immediately
 * instead of flashing the Approved spinner until the first status poll lands.
 * The poll still reconfirms against the server record.
 */
export function rememberApprovalOutcome(
  approvalId: string,
  value: ApprovalOutcome,
): void {
  hydrate();
  if (outcome.size >= MAX_ENTRIES) {
    const oldest = outcome.keys().next();
    if (!oldest.done) outcome.delete(oldest.value);
  }
  outcome.set(approvalId, value);
  persist();
}

export function getApprovalOutcome(
  approvalId: string,
): ApprovalOutcome | undefined {
  hydrate();
  return outcome.get(approvalId);
}
