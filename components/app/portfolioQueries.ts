"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryObserverResult } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth/auth-provider";
import { accountScope } from "@/lib/auth/session-identity";
import {
  SUPER_LOCK_EVENT,
  SUPER_UNLOCK_EVENT,
} from "@/lib/intents/user-session";
import { AuthExpiredError } from "./apiErrors";
import {
  buildPasskeySnapshot,
  fetchSessionPortfolio,
  passkeyPortfolioStatus,
  type PasskeyPortfolioRead,
} from "./passkeyPortfolioData";
import {
  countGroupRows,
  fetchPortfolio,
  FULL_NETWORK_GROUPS,
  mergePortfolioSnapshots,
  portfolioScope,
  readPortfolioCache,
  readSuperPrivateCache,
  writePortfolioCache,
  writePortfolioRowCount,
  writeSuperPrivateCache,
  type PortfolioSnapshot,
} from "./portfolioCache";
import { isIntentsGroupName, type AssetGroup } from "@/lib/wallet/balances";
import { useResolvedAssetMeta } from "./useAssetMeta";
import { useLiveSnapshot } from "./liveSnapshot";

export const PORTFOLIO_QUERY_KEY = ["portfolio"] as const;

/**
 * Wallet balances plus the settlement ledger, seeded from the last
 * snapshot. A cached portfolio paints at once and revalidates quietly;
 * the chain and address are always read together, so the same wallet
 * on two chains never shares an entry.
 */
export function usePortfolio(
  chain: string | null,
  address: string | null,
  enabled: boolean,
) {
  const { refresh } = useAuth();
  // A manual refresh must reach Alchemy, not the balances route's 300s
  // response cache. The flag is read by the query function and reset once
  // the refetch settles, so its retries stay uncached too.
  const forceRead = useRef(false);
  const scope = useMemo(
    () => (chain && address ? portfolioScope(chain, address) : null),
    [chain, address],
  );

  const query = useQuery<PortfolioSnapshot>({
    queryKey: [...PORTFOLIO_QUERY_KEY, scope ?? "anonymous"],
    queryFn: () => {
      if (!chain || !address) throw new Error("No wallet is connected.");
      return fetchPortfolio(
        address,
        chain,
        forceRead.current ? { refresh: true } : undefined,
      );
    },
    enabled: enabled && scope !== null,
    // Balances settle slowly: serve the cache for 300s across tab switches
    // and re-read behind it. Manual refresh and unlock/lock events refetch.
    staleTime: 300_000,
    retry: (count, error) =>
      !(error instanceof AuthExpiredError) && count < 2,
    initialData: () => (scope ? readPortfolioCache(scope) : undefined),
    initialDataUpdatedAt: 0,
  });

  const authExpired = query.error instanceof AuthExpiredError;

  useEffect(() => {
    if (authExpired) void refresh();
  }, [authExpired, refresh]);

  useEffect(() => {
    if (!scope || !query.data) return;
    writePortfolioCache(scope, query.data);
    const walletGroups =
      query.data.walletGroups ??
      query.data.groups.filter((group) => !isIntentsGroupName(group.name));
    writePortfolioRowCount(scope, "wallet", countGroupRows(walletGroups));
  }, [scope, query.data]);

  // The section title's Refresh calls this instead of `query.refetch`
  // directly: same revalidation and error handling, but with `refresh=1`
  // so the route re-reads the chains rather than replaying its cached
  // body. The watched reader already works this way.
  const readNow = async () => {
    forceRead.current = true;
    try {
      await query.refetch();
    } finally {
      forceRead.current = false;
    }
  };

  // The settled snapshot keeps its quantities; only the unit prices move.
  const liveSnapshot = useLiveSnapshot(query.data ?? null);

  return {
    snapshot: liveSnapshot,
    error: query.error,
    authExpired,
    isPending: query.isPending,
    // Background revalidation counts too, so the title row shows the
    // in-flight state the same way the watched section does.
    isRefreshing: query.isFetching && query.data !== undefined,
    refresh: readNow,
  };
}

/* Non-EVM chains read in one request; the single group below stands in
 * for the network fan-out so the merge path stays the same shape. */
const SINGLE_NETWORK_GROUP: string[] = ["__all__"];

type WatchedGroupRead = {
  /** The resolved group snapshots. */
  parts: PortfolioSnapshot[];
  complete: boolean;
  fetching: boolean;
  authExpired: boolean;
  firstError: Error | null;
};

/* useQueries hands back a fresh results array on every render, so deriving
 * the merge inputs from it re-merged — and re-set — the shown snapshot on
 * every render, which React ends at the 51st consecutive passive update
 * with "Maximum update depth exceeded". Combining inside the observer keeps
 * the aggregate referentially stable (structural sharing) unless content
 * actually moved, so the candidate below only changes on a real read. */
function combineWatchedGroups(
  results: Array<QueryObserverResult<PortfolioSnapshot, Error>>,
): WatchedGroupRead {
  return {
    parts: results.flatMap((query) =>
      query.data !== undefined ? [query.data] : [],
    ),
    complete:
      results.length > 0 && results.every((query) => query.isFetched),
    fetching: results.some(
      (query) => query.isFetching || query.isPending,
    ),
    authExpired: results.some(
      (query) => query.error instanceof AuthExpiredError,
    ),
    firstError: results.find((query) => query.error !== null)?.error ?? null,
  };
}



/* Upserts one side of the portfolio by group: a group the partial carries
 * merges item-by-item (matching ids replace, new ids append, absent ids
 * stay), a group it does not carry stays untouched, and a brand-new
 * network group appends. The ledger is identical in every group response,
 * so it replaces wholesale whenever the partial carries it. Items
 * re-sort by value after the upsert — live reorder is allowed because
 * the rows stay keyed by stable id and morph in place. */
function overlayItemGroups(
  prevGroups: AssetGroup[],
  nextGroups: AssetGroup[],
): AssetGroup[] {
  const nextByName = new Map(nextGroups.map((group) => [group.name, group]));
  const prevNames = new Set(prevGroups.map((group) => group.name));
  const out: AssetGroup[] = prevGroups.map((prev) => {
    const next = nextByName.get(prev.name);
    if (!next || isIntentsGroupName(prev.name)) return next ?? prev;
    const byId = new Map(prev.items.map((item) => [item.id, item]));
    for (const item of next.items) byId.set(item.id, item);
    const items = [...byId.values()].sort(
      (a, b) => b.valueUsd - a.valueUsd || a.symbol.localeCompare(b.symbol),
    );
    return { ...prev, items };
  });
  for (const next of nextGroups) {
    if (!prevNames.has(next.name)) out.push(next);
  }
  return out;
}

/* Overlays a partial chunk merge onto the painted snapshot. Wallet
 * groups upsert so nothing vanishes mid-load; the ledger follows the
 * richest-part rule by replacing wholesale when the partial carries it.
 * Totals are recomputed as the sum of what is on screen, split wallet
 * versus Near Intents, so the hero and the table always agree. */
function overlaySnapshot(
  prev: PortfolioSnapshot,
  next: PortfolioSnapshot,
): PortfolioSnapshot {
  const prevWallet =
    prev.walletGroups ??
    prev.groups.filter((group) => !isIntentsGroupName(group.name));
  const nextWallet =
    next.walletGroups ??
    next.groups.filter((group) => !isIntentsGroupName(group.name));
  const nextLedger =
    next.superGroups ??
    next.groups.filter((group) => isIntentsGroupName(group.name));
  const walletGroups = overlayItemGroups(prevWallet, nextWallet);
  const superGroups =
    nextLedger.length > 0 ? nextLedger : (prev.superGroups ?? []);
  const round = (n: number) => Number.parseFloat(n.toFixed(2));
  const sum = (groups: AssetGroup[]) =>
    groups.reduce(
      (total, group) =>
        total + group.items.reduce((sub, item) => sub + item.valueUsd, 0),
      0,
    );
  const walletUsd = round(sum(walletGroups));
  const superUsd = round(sum(superGroups));
  // Group order follows the painted snapshot; brand-new networks append
  // in the partial's order. The complete merge restores canonical order.
  const order = new Map<string, number>();
  for (const group of [...prev.groups, ...next.groups]) {
    if (!order.has(group.name)) order.set(group.name, order.size);
  }
  const groups = [...walletGroups, ...superGroups].sort(
    (a, b) => (order.get(a.name) ?? 9999) - (order.get(b.name) ?? 9999),
  );
  return {
    groups,
    totalUsd: round(walletUsd + superUsd),
    walletGroups,
    superGroups,
    walletUsd,
    superUsd,
  };
}

/**
 * A watched address, read from the public ledger only.
 *
 * This hook calls the same public balances route the wallet tab reads: the
 * Alchemy portfolio read and the Intents ledger view calls, neither of which
 * takes a session token. It never touches the private readers
 * (`useSuperPrivateBalances`, `fetchSessionPortfolio`, the passkey
 * portfolio), so a watched view cannot render an unlock card or a private
 * row by construction.
 */
export function useWatchedPortfolio(
  chain: string | null,
  address: string | null,
  enabled: boolean,
) {
  const queryClient = useQueryClient();
  const scope = useMemo(
    () =>
      chain && address ? `watched:${accountScope(chain, address)}` : null,
    [chain, address],
  );
  const [manualRefreshing, setManualRefreshing] = useState(false);
  // A new watched address starts unrefreshed. Derived during render so no
  // effect syncs the scope into state.
  const [prevScope, setPrevScope] = useState(scope);
  if (prevScope !== scope) {
    setPrevScope(scope);
    if (manualRefreshing) setManualRefreshing(false);
  }

  const fast = useQuery<PortfolioSnapshot>({
    queryKey: [...PORTFOLIO_QUERY_KEY, scope ?? "watched:anonymous", "fast"],
    queryFn: () => {
      if (!chain || !address) throw new Error("No watched address is selected.");
      return fetchPortfolio(address, chain, { mode: "fast" });
    },
    enabled: enabled && scope !== null,
    // Same paint-at-once contract as the wallet portfolio.
    staleTime: 300_000,
    gcTime: 600_000,
    retry: (count, error) =>
      !(error instanceof AuthExpiredError) && count < 2,
    initialData: () => (scope ? readPortfolioCache(scope) : undefined),
    initialDataUpdatedAt: 0,
  });

  // The EVM read fans out per network group so each chunk paints as it
  // lands. Other chains read in one request: their balances ignore the
  // EVM network filter, so grouping them would only empty the merge.
  const fullGroups = useMemo(
    () => (chain === "evm" ? FULL_NETWORK_GROUPS : SINGLE_NETWORK_GROUP),
    [chain],
  );
  const groupQueryOptions = useMemo(
    () =>
      fullGroups.map((group) => ({
        queryKey: [
          ...PORTFOLIO_QUERY_KEY,
          scope ?? "watched:anonymous",
          "full",
          group,
        ],
        queryFn: () => {
          if (!chain || !address)
            throw new Error("No watched address is selected.");
          return fetchPortfolio(address, chain, {
            mode: "full",
            ...(group === "__all__" ? {} : { networks: group }),
          });
        },
        enabled:
          enabled &&
          scope !== null &&
          (fast.data !== undefined || fast.isFetched),
        // Same paint-at-once contract as the wallet portfolio.
        staleTime: 300_000,
        gcTime: 600_000,
        retry: (count: number, error: Error) =>
          !(error instanceof AuthExpiredError) && count < 2,
      })),
    [fullGroups, scope, chain, address, enabled, fast.data, fast.isFetched],
  );

  const grouped = useQueries({
    queries: groupQueryOptions,
    combine: combineWatchedGroups,
  });

  const mergedFull = useMemo(
    () =>
      grouped.parts.length > 0
        ? mergePortfolioSnapshots(grouped.parts)
        : null,
    [grouped.parts],
  );

  // Every group has answered (data or error). Partial merges before this
  // point cover fewer networks than a cached full, so they stay out of
  // the cache — but not off the screen (see the progressive shown below).
  const complete = grouped.complete;

  const candidate = mergedFull ?? fast.data ?? null;

  // The screen grows within a load: each landed chunk merges over the
  // painted snapshot instead of waiting for every group, so a large
  // address streams in rather than arriving all at once. Item ids are
  // stable (`rawNet-symbol-contractAddress`), so matching ids replace in
  // place and the row morphs on its key; new ids append; ids absent from
  // the partial stay put. Only a complete merge replaces wholesale — and
  // prunes — even downward, because that is a real balance change.
  // Within a group the items re-sort by value, so live reorder is
  // allowed: the rows stay keyed by stable id, and the table's
  // pagination key carries no data, so the visible count survives each
  // overlay. Seeded from the cache so a reload paints instantly. The
  // snapshot is stored with the scope it belongs to: for one render after
  // a card switch the state still holds the previous account, and handing
  // that to the new address made the text change before its numbers.
  const [shown, setShown] = useState<{
    scope: string | null;
    snapshot: PortfolioSnapshot | null;
  }>(() => ({
    scope,
    snapshot: scope ? readPortfolioCache(scope) ?? null : null,
  }));
  /* eslint-disable react-hooks/set-state-in-effect -- scope reset: the shown
   * snapshot belongs to one watched address, like the filter reset below */
  useEffect(() => {
    setShown({
      scope,
      snapshot: scope ? readPortfolioCache(scope) ?? null : null,
    });
  }, [scope]);
  /* eslint-enable react-hooks/set-state-in-effect */
  /* eslint-disable react-hooks/set-state-in-effect -- progressive shown: a
   * partial merge overlays the painted snapshot, a complete merge wins */
  useEffect(() => {
    if (!candidate) return;
    setShown((prev) => {
      const current = prev.snapshot;
      let next = current;
      if (complete) {
        next = candidate;
      } else if (mergedFull) {
        if (current === null) {
          next = candidate.totalUsd > 0 ? candidate : current;
        } else {
          next = overlaySnapshot(current, mergedFull);
        }
      } else if (current === null) {
        // Fast read only, no chunk landed yet: hold the cached full until
        // the chunks start overlaying above.
        next = candidate.totalUsd > 0 ? candidate : current;
      } else if (candidate.totalUsd >= current.totalUsd) {
        next = candidate;
      }
      return { scope, snapshot: next };
    });
  }, [candidate, complete, mergedFull, scope]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // A snapshot from another scope is no snapshot: the detail keeps its
  // last pair until this account's own read lands, so the address and the
  // numbers advance together and the hero morph has nothing to queue.
  const snapshot = shown.scope === scope ? shown.snapshot : null;
  const liveSnapshot = useLiveSnapshot(snapshot);
  const isPending = snapshot === null;
  const isRefreshing =
    (fast.isFetching || grouped.fetching || manualRefreshing) &&
    snapshot !== null;
  const authExpired =
    fast.error instanceof AuthExpiredError || grouped.authExpired;
  const firstGroupError = grouped.firstError;
  const error = snapshot === null ? (firstGroupError ?? fast.error ?? null) : null;

  const refresh = async () => {
    if (!chain || !address || !scope) return;
    setManualRefreshing(true);
    try {
      const [fastData, ...groupDatas] = await Promise.all([
        fetchPortfolio(address, chain, { mode: "fast", refresh: true }),
        ...fullGroups.map((group) =>
          fetchPortfolio(address, chain, {
            mode: "full",
            ...(group === "__all__" ? {} : { networks: group }),
            refresh: true,
          }),
        ),
      ]);
      queryClient.setQueryData(
        [...PORTFOLIO_QUERY_KEY, scope, "fast"],
        fastData,
      );
      groupDatas.forEach((data, index) => {
        queryClient.setQueryData(
          [...PORTFOLIO_QUERY_KEY, scope, "full", fullGroups[index]],
          data,
        );
      });
      const merged = mergePortfolioSnapshots(groupDatas);
      writePortfolioCache(scope, merged);
      writePortfolioRowCount(scope, "watched", countGroupRows(merged.groups));
    } finally {
      setManualRefreshing(false);
    }
  };

  useEffect(() => {
    if (!scope || !complete || !mergedFull) return;
    writePortfolioCache(scope, mergedFull);
    writePortfolioRowCount(scope, "watched", countGroupRows(mergedFull.groups));
  }, [scope, complete, mergedFull]);

  return {
    snapshot: liveSnapshot,
    error,
    authExpired,
    isPending,
    isRefreshing,
    refresh,
  };
}

/**
 * The confidential side of a wallet's super account, read in the
 * browser with its own User-Session. A locked result is data, not a
 * failure: the page offers the unlock card instead of balances. The
 * public ledger the server reads stays visible underneath; a private
 * row wins when both name the same token.
 *
 * A passkey account reads through the same hook with `chain` set to
 * `passkey` and its account id as the address: it has no wallet, but it
 * has its own User-Session and its own confidential ledger.
 */
export function useSuperPrivateBalances(
  chain: string | null,
  address: string | null,
  enabled: boolean,
) {
  const scope = useMemo(
    () => (chain && address ? `super-private:${accountScope(chain, address)}` : null),
    [chain, address],
  );

  const query = useQuery<PasskeyPortfolioRead>({
    queryKey: [...PORTFOLIO_QUERY_KEY, scope ?? "super-private:anonymous"],
    queryFn: () => {
      if (!chain || !address) throw new Error("No wallet is connected.");
      return fetchSessionPortfolio(chain, address);
    },
    enabled: enabled && scope !== null,
    // Same paint-at-once contract as the wallet portfolio: the last
    // private snapshot renders instantly and revalidates quietly, so the
    // tab never drops to a bare loading line while the read is in flight.
    staleTime: 300_000,
    retry: false,
    initialData: () => (scope ? readSuperPrivateCache(scope) : undefined),
    initialDataUpdatedAt: 0,
  });

  const entries = useMemo(
    () => (query.data?.ok ? query.data.entries : []),
    [query.data],
  );
  const ids = useMemo(
    () => entries.map((entry) => entry.tokenId),
    [entries],
  );
  const meta = useResolvedAssetMeta(ids);
  const snapshot = useMemo(
    () => (query.data?.ok ? buildPasskeySnapshot(entries, meta) : null),
    [query.data, entries, meta],
  );
  // The private rows carry the ledger's asset ids, so they read the same
  // live store as the public side instead of ageing with the metadata read.
  const liveSnapshot = useLiveSnapshot(snapshot);

  const refresh = query.refetch;

  // Write-through: the next mount paints this read instantly.
  // Only successful reads are kept; locked and error states re-check.
  useEffect(() => {
    if (!scope || !query.data) return;
    writeSuperPrivateCache(scope, query.data);
  }, [scope, query.data]);

  // Subscribe even while the query is disabled. The unlock event fires
  // before React re-renders with `enabled: true`, and React Query will not
  // refetch fresh cached data merely because the query became enabled. A
  // direct refetch here always re-reads with the token that was just saved.
  useEffect(() => {
    if (!scope) return;
    const reread = () => {
      void refresh();
    };
    window.addEventListener(SUPER_UNLOCK_EVENT, reread);
    window.addEventListener(SUPER_LOCK_EVENT, reread);
    return () => {
      window.removeEventListener(SUPER_UNLOCK_EVENT, reread);
      window.removeEventListener(SUPER_LOCK_EVENT, reread);
    };
  }, [scope, refresh]);

  return {
    status: query.isError
      ? ("error" as const)
      : passkeyPortfolioStatus(query.data),
    snapshot: liveSnapshot,
    entries,
    error: query.error,
    isPending: query.isPending,
    // Drives the title row's in-flight state alongside the public read.
    isRefreshing: query.isFetching && query.data !== undefined,
    refresh,
  };
}
