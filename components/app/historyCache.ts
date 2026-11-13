import type { InfiniteData } from "@tanstack/react-query";
import { AuthExpiredError } from "./apiErrors";

/* ─────────────────────────────────────────────────────────
 * HISTORY CACHE
 * Module-level memory shared by every view that shows the
 * settlement record, with a sessionStorage copy so a reload
 * still paints instantly. The page seeds from here and
 * revalidates in the background, so returning to History never
 * flashes a loading line. Nothing here touches React.
 * ───────────────────────────────────────────────────────── */

export type HistoryTone = "neutral" | "accent" | "green" | "red" | "orange";

export type HistoryRow = {
  id: string;
  state: string;
  depositAddress: string | null;
  recipient: string | null;
  originAsset: string | null;
  destinationAsset: string | null;
  amountIn: string | null;
  expectedOut: string | null;
  amountOut: string | null;
  explorerUrls: string[];
  conversationId: string | null;
  createdAt: string;
};

export type HistoryPage = {
  transactions: HistoryRow[];
  nextCursor: string | null;
};

export type HistoryCache = {
  pages: HistoryPage[];
  pageParams: (string | null)[];
};

/** Presentation for a settlement state. Unknown states stay readable. */
export function historyStateMeta(state: string): {
  label: string;
  tone: HistoryTone;
} {
  switch (state) {
    case "settled":
      return { label: "Executed", tone: "green" };
    case "refunded":
      return { label: "Refunded", tone: "neutral" };
    case "failed":
    case "incomplete_deposit":
      return { label: "Failed", tone: "red" };
    case "needs_reconciliation":
      return { label: "Needs review", tone: "orange" };
    case "processing":
      return { label: "Processing", tone: "accent" };
    case "pending":
      return { label: "Pending", tone: "orange" };
    case "confirming":
      return { label: "Confirming", tone: "accent" };
    case "submitted":
      return { label: "Submitted", tone: "accent" };
    case "expired":
      return { label: "Expired", tone: "red" };
    default:
      return { label: state, tone: "neutral" };
  }
}

/** States the settlement workflow can still move on its own. */
export const LIVE_HISTORY_STATES = [
  "submitted",
  "pending",
  "processing",
  "confirming",
] as const;

export function isLiveHistoryRow(row: HistoryRow): boolean {
  return (LIVE_HISTORY_STATES as readonly string[]).includes(row.state);
}

/** One account's shape, for the skeleton before the first read lands. */
export const SAMPLE_HISTORY_ROWS: HistoryRow[] = [
  {
    id: "sample-1",
    state: "settled",
    depositAddress: null,
    recipient: null,
    originAsset: "nep141:usdc.near",
    destinationAsset: "nep141:eth.omft.near",
    amountIn: "250.00",
    expectedOut: "0.0812",
    amountOut: "0.0816",
    explorerUrls: [],
    conversationId: null,
    createdAt: "2026-11-03T14:22:00.000Z",
  },
  {
    id: "sample-2",
    state: "processing",
    depositAddress: null,
    recipient: null,
    originAsset: "nep141:eth.omft.near",
    destinationAsset: "nep141:btc.omft.near",
    amountIn: "0.0340",
    expectedOut: "0.0012",
    amountOut: null,
    explorerUrls: [],
    conversationId: null,
    createdAt: "2026-11-02T09:08:00.000Z",
  },
  {
    id: "sample-3",
    state: "refunded",
    depositAddress: null,
    recipient: null,
    originAsset: "nep141:usdc.near",
    destinationAsset: "nep141:sol.omft.near",
    amountIn: "75.00",
    expectedOut: "0.42",
    amountOut: null,
    explorerUrls: [],
    conversationId: null,
    createdAt: "2026-11-01T18:41:00.000Z",
  },
];

const STORAGE_PREFIX = "myntle-history-v1";
/** Keep the stored copy small; older pages come back with Load more. */
const MAX_STORED_PAGES = 4;

const memory = new Map<string, HistoryCache>();

function storageKey(scope: string): string {
  return `${STORAGE_PREFIX}:${scope}`;
}

function validCache(value: unknown): value is HistoryCache {
  if (!value || typeof value !== "object") return false;
  const candidate = value as HistoryCache;
  return (
    Array.isArray(candidate.pages) &&
    Array.isArray(candidate.pageParams) &&
    candidate.pages.every(
      (page) =>
        page &&
        typeof page === "object" &&
        Array.isArray(page.transactions) &&
        (page.nextCursor === null || typeof page.nextCursor === "string"),
    )
  );
}

export function readHistoryCache(scope: string): HistoryCache | undefined {
  const mem = memory.get(scope);
  if (mem) return mem;
  try {
    if (typeof sessionStorage !== "undefined") {
      const raw = sessionStorage.getItem(storageKey(scope));
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (validCache(parsed)) {
          memory.set(scope, parsed);
          return parsed;
        }
      }
    }
  } catch {
    // Quota, private mode, or malformed storage. Fall through.
  }
  return undefined;
}

export function writeHistoryCache(scope: string, cache: HistoryCache) {
  memory.set(scope, cache);
  const pages = cache.pages.slice(0, MAX_STORED_PAGES);
  const pageParams = cache.pageParams.slice(0, pages.length);
  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(
        storageKey(scope),
        JSON.stringify({ pages, pageParams } satisfies HistoryCache),
      );
    }
  } catch {
    // Private mode. Memory still covers the session.
  }
}

export function clearHistoryCache() {
  memory.clear();
  try {
    if (typeof sessionStorage !== "undefined") {
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const key = sessionStorage.key(i);
        if (key?.startsWith(`${STORAGE_PREFIX}:`)) {
          sessionStorage.removeItem(key);
        }
      }
    }
  } catch {
    // Ignore.
  }
}

/** Fetches one page of the record. Throws only when it has to. */
export async function fetchHistoryPage(
  cursor: string | null,
): Promise<HistoryPage> {
  const params = new URLSearchParams({ limit: "20" });
  if (cursor) params.set("cursor", cursor);
  const res = await fetch(`/api/history?${params.toString()}`, {
    cache: "no-store",
  });
  if (res.status === 401) throw new AuthExpiredError();
  if (!res.ok) throw new Error("History is unavailable.");
  const body = (await res.json()) as {
    transactions?: HistoryRow[];
    nextCursor?: string | null;
  } | null;
  return {
    transactions: body?.transactions ?? [],
    nextCursor: body?.nextCursor ?? null,
  };
}

/**
 * Folds a fresh first page into the pages already on screen.
 *
 * Refetching the whole infinite query would move the cursor under
 * every later page and drop the row that fell between them. Instead
 * the newest page is merged in place: newcomers go to the top, and a
 * known row updates wherever it sits.
 */
export function mergeNewestPage(
  current: InfiniteData<HistoryPage, string | null>,
  fresh: HistoryPage,
): InfiniteData<HistoryPage, string | null> {
  if (current.pages.length === 0) return current;
  const byId = new Map(fresh.transactions.map((row) => [row.id, row]));
  const known = new Set(
    current.pages.flatMap((page) => page.transactions.map((row) => row.id)),
  );
  const newcomers = fresh.transactions.filter((row) => !known.has(row.id));
  return {
    ...current,
    pages: current.pages.map((page, index) => ({
      ...page,
      transactions:
        index === 0
          ? [...newcomers, ...page.transactions.map((row) => byId.get(row.id) ?? row)]
          : page.transactions.map((row) => byId.get(row.id) ?? row),
      // An empty first page has no cursor of its own yet; adopt the fresh
      // one so the first arriving trade can still be paged past.
      nextCursor:
        index === 0 ? (page.nextCursor ?? fresh.nextCursor) : page.nextCursor,
    })),
  };
}
