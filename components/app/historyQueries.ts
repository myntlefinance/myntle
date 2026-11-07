"use client";

import { useEffect, useMemo } from "react";
import {
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { useAuth } from "@/lib/auth/auth-provider";
import { AuthExpiredError } from "./apiErrors";
import {
  fetchHistoryPage,
  isLiveHistoryRow,
  mergeNewestPage,
  readHistoryCache,
  writeHistoryCache,
  type HistoryPage,
  type HistoryRow,
} from "./historyCache";

export const HISTORY_QUERY_KEY = ["history"] as const;

const LIVE_POLL_MS = 10_000;

/**
 * The settlement record, seeded from the last snapshot.
 *
 * The first paint comes from memory (or the session copy), then a
 * background read keeps it honest. While a visible trade is still in
 * flight the newest page is folded back in every ten seconds, which
 * is the same record the workflow reconciles against.
 */
export function useHistory(scope: string | null, enabled: boolean) {
  const queryClient = useQueryClient();
  const { refresh } = useAuth();

  const queryKey = useMemo(
    () => [...HISTORY_QUERY_KEY, scope ?? "anonymous"] as const,
    [scope],
  );

  const query = useInfiniteQuery<
    HistoryPage,
    Error,
    InfiniteData<HistoryPage, string | null>,
    typeof queryKey,
    string | null
  >({
    queryKey,
    queryFn: ({ pageParam }) => fetchHistoryPage(pageParam),
    initialPageParam: null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: enabled && scope !== null,
    // A new approval writes its row immediately, so every visit re-reads
    // in the background. The cached list stays on screen meanwhile.
    staleTime: 0,
    retry: (count, error) =>
      !(error instanceof AuthExpiredError) && count < 2,
    initialData: () => {
      if (!scope) return undefined;
      const cached = readHistoryCache(scope);
      return cached
        ? { pages: cached.pages, pageParams: cached.pageParams }
        : undefined;
    },
    initialDataUpdatedAt: 0,
  });

  const rows: HistoryRow[] | null = useMemo(
    () =>
      query.data
        ? query.data.pages.flatMap((page) => page.transactions)
        : null,
    [query.data],
  );

  const hasLive = useMemo(
    () => (rows ?? []).some(isLiveHistoryRow),
    [rows],
  );

  const authExpired = query.error instanceof AuthExpiredError;

  // The session can expire between the page opening and this read.
  // Re-checking flips the page back to the sign-in prompt.
  useEffect(() => {
    if (authExpired) void refresh();
  }, [authExpired, refresh]);

  // Keep the snapshot current without re-reading every page: the first
  // page is folded into place, so cursors behind it never move.
  useEffect(() => {
    if (!scope || !enabled || !hasLive || query.isError) return;
    let cancelled = false;
    const tick = () => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        return;
      }
      void fetchHistoryPage(null)
        .then((fresh) => {
          if (cancelled) return;
          queryClient.setQueryData<InfiniteData<HistoryPage, string | null>>(
            queryKey,
            (current) =>
              current ? mergeNewestPage(current, fresh) : current,
          );
        })
        .catch(() => {
          // The next tick retries. A failed poll never clears the list.
        });
    };
    const timer = setInterval(tick, LIVE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [
    scope,
    enabled,
    hasLive,
    query.isError,
    queryClient,
    queryKey,
  ]);

  // Persist every settled read, including the folded live updates.
  useEffect(() => {
    if (!scope || !query.data) return;
    writeHistoryCache(scope, query.data);
  }, [scope, query.data]);

  return {
    rows,
    // A cached list stays on screen when a background read fails; the
    // blocking error only belongs to an empty first visit.
    error: query.error,
    authExpired,
    isPending: query.isPending,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    loadMore: () => {
      if (query.hasNextPage && !query.isFetchingNextPage) {
        void query.fetchNextPage();
      }
    },
  };
}
