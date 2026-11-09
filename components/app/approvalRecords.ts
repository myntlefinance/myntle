import type { DepositMetadata } from "@/lib/intents/deposit-metadata";
import { isRefreshableDepositRecord } from "@/lib/intents/deposit-status";
import type { ApprovalDecisions, SettlementSnapshot } from "./approvals";

/**
 * Paint cache for approval records.
 *
 * The message cache lets a thread paint on the switch; this cache gives its
 * cards the same head start. A decision and a settlement are read once by
 * `/api/approvals/state`, then kept here by approval id so a revisit, a
 * same-tab reload, or a hover-prefetched click paints the address, the state,
 * and the drawer on the first frame instead of expanding into them.
 *
 * Nothing here decides money. The server remains the authority, every cached
 * answer is revalidated by `/api/approvals/state`, and a card with no known
 * record still waits for that read before it offers a decision.
 */

export type CachedApprovalRecords = {
  decisions: ApprovalDecisions;
  settlements: Record<string, SettlementSnapshot>;
  /** The ids that have a decision or a settlement worth painting. */
  known: Set<string>;
};

type StoredRecord = {
  decision?: "approved" | "denied";
  settlement?: SettlementSnapshot;
};

/** One response shape from `/api/approvals/state`. */
type SettlementPayload = {
  toolApprovalId: string;
  transactionId: string;
  state: string;
  depositAddress?: string | null;
  explorerUrls?: string[];
  statusCheckedAt?: string | null;
  amountOut?: string | null;
  deposit?: DepositMetadata | null;
};

const STORAGE_KEY = "myntle-approval-records-v1";
const MAX_ENTRIES = 500;

const records = new Map<string, StoredRecord>();
const inflight = new Map<string, Promise<CachedApprovalRecords | null>>();
let hydrated = false;

function storage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      return window.sessionStorage;
    }
    const global = globalThis as { sessionStorage?: Storage };
    return global.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function isSettlement(value: unknown): value is SettlementSnapshot {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.state === "string" &&
    typeof record.transactionId === "string"
  );
}

/** A settlement is proof of approval, so it also supplies the decision. */
function normalize(record: StoredRecord): StoredRecord {
  if (record.settlement && !record.decision) {
    return { ...record, decision: "approved" };
  }
  return record;
}

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  const store = storage();
  if (!store) return;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, StoredRecord>;
    for (const [id, value] of Object.entries(parsed).slice(-MAX_ENTRIES)) {
      if (!value || typeof value !== "object") continue;
      const record: StoredRecord = {};
      if (value.decision === "approved" || value.decision === "denied") {
        record.decision = value.decision;
      }
      if (isSettlement(value.settlement)) {
        record.settlement = value.settlement;
      }
      if (record.decision || record.settlement) {
        records.set(id, normalize(record));
      }
    }
  } catch {
    // Corrupt storage never breaks a card; memory still works.
  }
}

function persist(): void {
  const store = storage();
  if (!store) return;
  try {
    const entries = [...records.entries()].slice(-MAX_ENTRIES);
    store.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Quota or privacy mode: memory still covers this session.
  }
}

function update(id: string, patch: StoredRecord): void {
  hydrate();
  if (!id) return;
  if (records.size >= MAX_ENTRIES && !records.has(id)) {
    const oldest = records.keys().next();
    if (!oldest.done) records.delete(oldest.value);
  }
  records.set(id, normalize({ ...records.get(id), ...patch }));
}

/** The cut of the cache a set of cards can paint from, right now. */
export function readApprovalRecords(
  ids: readonly string[],
): CachedApprovalRecords {
  hydrate();
  const decisions: ApprovalDecisions = {};
  const settlements: Record<string, SettlementSnapshot> = {};
  const known = new Set<string>();
  for (const id of new Set(ids)) {
    const record = records.get(id);
    if (!record) continue;
    if (record.decision) {
      decisions[id] = record.decision;
      known.add(id);
    }
    if (record.settlement) {
      settlements[id] = record.settlement;
      known.add(id);
    }
  }
  return { decisions, settlements, known };
}

/** The cards whose record has never been read, so they still need the server. */
export function pendingApprovalRecordIds(ids: readonly string[]): string[] {
  const known = readApprovalRecords(ids).known;
  return [...new Set(ids)].filter((id) => !known.has(id));
}

/**
 * True when a visible card can still learn something from the server.
 *
 * A missing record is the obvious case. An approved record without a
 * settlement is the second: the card needs the transaction id and the
 * one-time address before it can poll. A denial is final. A settlement is
 * final only once it is terminal; a live one can still change, and a
 * superseded card does not run the active poll itself, so the visible card
 * asks once. Reading the rest would only repeat work the card already owns.
 */
export function approvalRecordNeedsRead(approvalId: string): boolean {
  hydrate();
  const record = records.get(approvalId);
  if (!record) return true;
  if (record.settlement) {
    return isRefreshableDepositRecord(record.settlement.state);
  }
  return record.decision === "approved";
}

/** Writes a decision this tab just took, so the card repaints without a read. */
export function rememberApprovalDecision(
  approvalId: string,
  decision: "approved" | "denied",
): void {
  update(approvalId, { decision });
  persist();
}

export function rememberApprovalSettlement(
  approvalId: string,
  settlement: SettlementSnapshot,
): void {
  update(approvalId, { settlement });
  persist();
}

/**
 * Writes one server answer into the cache.
 *
 * A missing decision or settlement never erases a cached one: both are
 * append-only records, and a partial answer should not turn a painted card
 * blank again.
 */
export function writeApprovalRecords(input: {
  approvalIds: readonly string[];
  decisions?: ApprovalDecisions;
  settlements?: Record<string, SettlementSnapshot>;
}): void {
  hydrate();
  const requested = new Set(input.approvalIds);
  for (const [id, decision] of Object.entries(input.decisions ?? {})) {
    if (!requested.has(id)) continue;
    if (decision !== "approved" && decision !== "denied") continue;
    update(id, { decision });
  }
  for (const [id, settlement] of Object.entries(input.settlements ?? {})) {
    if (!requested.has(id)) continue;
    if (!isSettlement(settlement)) continue;
    update(id, { settlement });
  }
  persist();
}

/**
 * One cached read of `/api/approvals/state`.
 *
 * The promise is shared by the card host and hover-prefetch, so opening a
 * thread whose records are already being warmed cannot fire the same request
 * twice. A failed read returns null; the caller keeps its last known answer.
 */
export function fetchApprovalRecords(
  ids: readonly string[],
): Promise<CachedApprovalRecords | null> {
  const unique = [...new Set(ids.filter((id) => id.length > 0))].slice(-200);
  if (unique.length === 0) {
    return Promise.resolve({ decisions: {}, settlements: {}, known: new Set() });
  }
  const key = [...unique].sort().join(",");
  const existing = inflight.get(key);
  if (existing) return existing;

  const request = (async () => {
    try {
      const res = await fetch("/api/approvals/state", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approvalIds: unique }),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as {
        decisions?: ApprovalDecisions;
        settlements?: SettlementPayload[];
      } | null;
      if (!body) return null;

      const requested = new Set(unique);
      const decisions: ApprovalDecisions = {};
      const rawDecisions =
        body.decisions && typeof body.decisions === "object"
          ? body.decisions
          : {};
      for (const [id, decision] of Object.entries(rawDecisions)) {
        if (!requested.has(id)) continue;
        if (decision === "approved" || decision === "denied") {
          decisions[id] = decision;
        }
      }
      const settlements: Record<string, SettlementSnapshot> = {};
      const rawSettlements = Array.isArray(body.settlements)
        ? body.settlements
        : [];
      for (const settlement of rawSettlements) {
        const id = settlement?.toolApprovalId;
        if (!id || !requested.has(id)) continue;
        if (!settlement.transactionId || !settlement.state) continue;
        settlements[id] = {
          state: settlement.state,
          transactionId: settlement.transactionId,
          depositAddress: settlement.depositAddress,
          explorerUrls: settlement.explorerUrls,
          statusCheckedAt: settlement.statusCheckedAt,
          amountOut: settlement.amountOut,
          deposit: settlement.deposit,
        };
        // A settlement is proof of approval; the route already treats it that
        // way, so the cached record can name the decision without a second read.
        if (!decisions[id]) decisions[id] = "approved";
      }

      writeApprovalRecords({ approvalIds: unique, decisions, settlements });
      return readApprovalRecords(unique);
    } catch {
      return null;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, request);
  return request;
}

/** Resets memory without touching storage. Only used by tests. */
export function resetApprovalRecords(): void {
  records.clear();
  inflight.clear();
  hydrated = false;
}

/** Resets all records and storage. Used by sign-out and by tests. */
export function clearApprovalRecords(): void {
  records.clear();
  inflight.clear();
  hydrated = false;
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(STORAGE_KEY);
  } catch {
    // Ignore.
  }
}
