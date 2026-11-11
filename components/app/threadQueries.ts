"use client";

import { useQuery } from "@tanstack/react-query";
import {
  fetchThreads,
  fetchTrashed,
  readThreadsCache,
  readTrashedCache,
  type ThreadItem,
  type TrashedItem,
} from "./threadCache";

export const THREADS_QUERY_KEY = ["threads"] as const;
export const TRASHED_QUERY_KEY = ["trashed"] as const;

export function useThreads(enabled = true) {
  return useQuery<ThreadItem[]>({
    queryKey: THREADS_QUERY_KEY,
    queryFn: () => fetchThreads(),
    staleTime: 30_000,
    initialData: () => readThreadsCache(),
    initialDataUpdatedAt: 0,
    // A signed-out load has no list to read; firing anyway only buys a 401
    // and a cache clear.
    enabled,
  });
}

export function useTrashed(limit = 50, enabled = true) {
  return useQuery<TrashedItem[]>({
    queryKey: TRASHED_QUERY_KEY,
    queryFn: () => fetchTrashed(limit),
    staleTime: 60_000,
    initialData: () => readTrashedCache(),
    initialDataUpdatedAt: 0,
    enabled,
  });
}
