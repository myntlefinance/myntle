/**
 * Settlement outcomes for decided approvals.
 *
 * The paused-turn snapshot saved mid-stream keeps saying
 * "approval-requested" forever (the decided update shares its id), so the
 * card cannot rely on message parts alone. Every decision is recorded here —
 * in memory for the session and in localStorage across reloads and chat
 * switches — and the collector prefers it over a stale snapshot.
 */

export type ApprovalTx = {
  transactionId: string;
  depositAddress: string;
};

const TX_KEY = "myntle.approval-tx.v1";
const DENIED_KEY = "myntle.approval-denied.v1";
const OUTCOME_KEY = "myntle.approval-outcome.v1";
const MAX_ENTRIES = 200;

export type ApprovalOutcome =
  | "settled"
  | "refunded"
  | "incomplete"
  | "failed";

const tx = new Map<string, ApprovalTx>();
const denied = new Set<string>();
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
    const rawDenied = store.getItem(DENIED_KEY);
    if (rawDenied) {
      const parsed = JSON.parse(rawDenied) as string[];
      if (Array.isArray(parsed)) {
        for (const id of parsed.slice(-MAX_ENTRIES)) {
          if (typeof id === "string") denied.add(id);
        }
      }
    }
    const rawOutcome = store.getItem(OUTCOME_KEY);
    if (rawOutcome) {
      const parsed = JSON.parse(rawOutcome) as Record<string, ApprovalOutcome>;
      for (const [id, value] of Object.entries(parsed).slice(-MAX_ENTRIES)) {
        if (value === "settled" || value === "refunded" || value === "failed" || value === "incomplete") {
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
    store.setItem(DENIED_KEY, JSON.stringify([...denied].slice(-MAX_ENTRIES)));
    const outcomeEntries = [...outcome.entries()].slice(-MAX_ENTRIES);
    store.setItem(OUTCOME_KEY, JSON.stringify(Object.fromEntries(outcomeEntries)));
  } catch {
    // Quota or privacy mode: memory still works for the session.
  }
}

/** Resets all records. Only used by tests. */
export function resetApprovalStore(): void {
  tx.clear();
  denied.clear();
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

export function rememberApprovalDenied(approvalId: string): void {
  hydrate();
  denied.add(approvalId);
  persist();
}

export function getApprovalTx(approvalId: string): ApprovalTx | undefined {
  hydrate();
  return tx.get(approvalId);
}

/**
 * Records a terminal settlement outcome so a reload paints it immediately
 * instead of flashing the Approved spinner until the first status poll lands.
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

export function isApprovalDenied(approvalId: string): boolean {
  hydrate();
  return denied.has(approvalId);
}
