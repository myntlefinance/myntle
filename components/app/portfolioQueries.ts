"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryObserverResult } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth/auth-provider";
import { accountScope } from "@/lib/auth/session-identity";
import {
  isSuperUnlocked,
  SUPER_LOCK_EVENT,
  SUPER_UNLOCK_EVENT,
} from "@/lib/intents/user-session";
import { AuthExpiredError } from "./apiErrors";
import {
  buildPasskeySnapshot,
  fetchPasskeyPortfolio,
  fetchSessionPortfolio,
  passkeyPortfolioScope,
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
import { useResolvedAssetMeta } from "./useAssetMeta";

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
  const scope = useMemo(
    () => (chain && address ? portfolioScope(chain, address) : null),
    [chain, address],
  );

  const query = useQuery<PortfolioSnapshot>({
    queryKey: [...PORTFOLIO_QUERY_KEY, scope ?? "anonymous"],
    queryFn: () => {
      if (!chain || !address) throw new Error("No wallet is connected.");
      return fetchPortfolio(address, chain);
    },
    enabled: enabled && scope !== null,
    // Balances settle slowly: serve the cache for 60s across tab switches
    // and re-read behind it. Manual refresh and unlock/lock events refetch.
    staleTime: 60_000,
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
      query.data.groups.filter((group) => group.name !== "Settlement Ledger");
    writePortfolioRowCount(scope, "wallet", countGroupRows(walletGroups));
  }, [scope, query.data]);

  return {
    snapshot: query.data ?? null,
    error: query.error,
    authExpired,
    isPending: query.isPending,
    refresh: query.refetch,
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

  useEffect(() => {
    setManualRefreshing(false);
  }, [scope]);

  const fast = useQuery<PortfolioSnapshot>({
    queryKey: [...PORTFOLIO_QUERY_KEY, scope ?? "watched:anonymous", "fast"],
    queryFn: () => {
      if (!chain || !address) throw new Error("No watched address is selected.");
      return fetchPortfolio(address, chain, { mode: "fast" });
    },
    enabled: enabled && scope !== null,
    // Same paint-at-once contract as the wallet portfolio.
    staleTime: 60_000,
    gcTime: 300_000,
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
        staleTime: 60_000,
        gcTime: 300_000,
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
  // the cache and, usually, off the screen.
  const complete = grouped.complete;

  const candidate = mergedFull ?? fast.data ?? null;

  // The screen is monotonic within a load: a partial merge or a fresh
  // fast read (top networks, first page) is smaller than the cached full
  // it would replace, so hold the painted snapshot until the merge is
  // complete or the candidate actually exceeds it. A complete merge
  // always wins, even downward — that is a real balance change.
  // Seeded from the cache so a reload paints instantly with no flash.
  const [shown, setShown] = useState<PortfolioSnapshot | null>(() =>
    scope ? readPortfolioCache(scope) ?? null : null,
  );
  /* eslint-disable react-hooks/set-state-in-effect -- scope reset: the shown
   * snapshot belongs to one watched address, like the filter reset below */
  useEffect(() => {
    setShown(scope ? readPortfolioCache(scope) ?? null : null);
  }, [scope]);
  /* eslint-enable react-hooks/set-state-in-effect */
  /* eslint-disable react-hooks/set-state-in-effect -- monotonic shown: the
   * painted snapshot only advances to larger or complete merges */
  useEffect(() => {
    if (!candidate) return;
    setShown((prev) => {
      if (prev === null)
        return candidate.totalUsd > 0 || complete ? candidate : prev;
      if (complete) return candidate;
      return candidate.totalUsd >= prev.totalUsd ? candidate : prev;
    });
  }, [candidate, complete]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const snapshot = shown;
  const isPending = shown === null;
  const isRefreshing =
    (fast.isFetching ||
      groupQueries.some((query) => query.isFetching || query.isPending) ||
      manualRefreshing) &&
    snapshot !== null;
  const authExpired =
    fast.error instanceof AuthExpiredError ||
    groupQueries.some((query) => query.error instanceof AuthExpiredError);
  const firstGroupError =
    groupQueries.find((query) => query.error !== null)?.error ?? null;
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
    snapshot,
    error,
    authExpired,
    isPending,
    isRefreshing,
    refresh,
  };
}

/**
 * The private balance of a passkey account, read in the browser.
 *
 * There is no wallet route here: a passkey account has no wallet, and the
 * confidential ledger is reached with the User-Session token held in this
 * tab. A locked result is data, not an error, so the page can offer the
 * unlock dialog instead of a failure. The unlock and lock events re-read
 * the balance, and the query scope is namespaced so it cannot share an
 * entry with a wallet.
 */
export function usePasskeyPortfolio(
  accountId: string | null,
  enabled: boolean,
) {
  const scope = useMemo(
    () => (accountId ? passkeyPortfolioScope(accountId) : null),
    [accountId],
  );

  const query = useQuery<PasskeyPortfolioRead>({
    queryKey: [...PORTFOLIO_QUERY_KEY, scope ?? "passkey:anonymous"],
    queryFn: () => {
      if (!accountId) throw new Error("No passkey account is signed in.");
      return fetchPasskeyPortfolio(accountId);
    },
    enabled: enabled && scope !== null,
    // Same 60s cache as the wallet hook; unlock/lock events refetch below.
    staleTime: 60_000,
    // The read reports its own locked and error states; a thrown failure is
    // unexpected, and retrying it would ask 1Click again for no benefit.
    retry: false,
    // Paint-at-once like the wallet side, but only while a session is
    // live: a locked account must show the unlock card, never the last
    // session's stale holdings.
    initialData: () =>
      scope && accountId && isSuperUnlocked("passkey", accountId)
        ? readSuperPrivateCache(scope)
        : undefined,
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

  const refresh = query.refetch;

  // Write-through: the next mount paints this read instantly.
  // Only successful reads are kept; locked and error states re-check.
  useEffect(() => {
    if (!scope || !query.data) return;
    writeSuperPrivateCache(scope, query.data);
  }, [scope, query.data]);

  useEffect(() => {
    if (!enabled || !scope) return;
    const reread = () => {
      void refresh();
    };
    window.addEventListener(SUPER_UNLOCK_EVENT, reread);
    window.addEventListener(SUPER_LOCK_EVENT, reread);
    return () => {
      window.removeEventListener(SUPER_UNLOCK_EVENT, reread);
      window.removeEventListener(SUPER_LOCK_EVENT, reread);
    };
  }, [enabled, scope, refresh]);

  return {
    status: query.isError
      ? ("error" as const)
      : passkeyPortfolioStatus(query.data),
    snapshot,
    entries,
    error: query.error,
    isPending: query.isPending,
    refresh,
  };
}

/**
 * The confidential side of a wallet's super account, read in the
 * browser with its own User-Session. A locked result is data, not a
 * failure: the page offers the unlock card instead of balances. The
 * public ledger the server reads stays visible underneath; a private
 * row wins when both name the same token.
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
    staleTime: 60_000,
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
    snapshot,
    entries,
    error: query.error,
    isPending: query.isPending,
    refresh,
  };
}
