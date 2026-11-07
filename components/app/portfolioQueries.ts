"use client";

import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth/auth-provider";
import {
  SUPER_LOCK_EVENT,
  SUPER_UNLOCK_EVENT,
} from "@/lib/intents/user-session";
import { AuthExpiredError } from "./apiErrors";
import {
  buildPasskeySnapshot,
  fetchPasskeyPortfolio,
  passkeyPortfolioScope,
  passkeyPortfolioStatus,
  type PasskeyPortfolioRead,
} from "./passkeyPortfolioData";
import {
  fetchPortfolio,
  portfolioScope,
  readPortfolioCache,
  writePortfolioCache,
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
