"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { WatchChain } from "@/lib/wallet/addresses";

/**
 * The watchlist over the routes, nothing else.
 *
 * Listing, adding, and removing all go through `/api/watchlist`; there is
 * no fetch code beyond the routes. The list holds for 60s — it changes
 * only through this tab — and mutations invalidate it. A tracked row is
 * written into the cached list before the re-read starts, so its card is
 * on screen while the dialog that asked for it is still open. Errors
 * surface in the query and mutation state, never as thrown promises.
 */

export type WatchlistEntry = {
  id: string;
  chain: WatchChain;
  address: string;
  label: string | null;
  /** The default a fresh visit opens to; at most one per list. */
  isDefault: boolean;
  createdAt: string;
  /** The normalized `.eth` name the row was tracked from, if any. */
  resolvedName?: string | null;
  /** Fresh ISO UTC from the read that stored the name, if any. */
  resolvedAt?: string | null;
};

export const WATCHLIST_QUERY_KEY = ["watchlist"] as const;

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function entryError(body: unknown): string {
  if (
    body &&
    typeof body === "object" &&
    typeof (body as { error?: unknown }).error === "string"
  ) {
    return (body as { error: string }).error;
  }
  return "The watchlist is unavailable.";
}

export async function fetchWatchlist(): Promise<WatchlistEntry[]> {
  const res = await fetch("/api/watchlist", { cache: "no-store" });
  const body = await readJson(res);
  if (!res.ok) throw new Error(entryError(body));
  const entries = (body as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) throw new Error("The watchlist is unavailable.");
  return entries as WatchlistEntry[];
}

export async function addWatchlistEntry(input: {
  chain: WatchChain;
  /** A raw address, or a `.eth` name on EVM — the server resolves names
   * itself and never trusts an address the client worked out. */
  address: string;
  label?: string;
}): Promise<WatchlistEntry> {
  const res = await fetch("/api/watchlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await readJson(res);
  if (!res.ok) throw new Error(entryError(body));
  const entry = (body as { entry?: unknown }).entry;
  if (!entry || typeof entry !== "object") {
    throw new Error("The watchlist is unavailable.");
  }
  return entry as WatchlistEntry;
}

export async function removeWatchlistEntry(id: string): Promise<void> {
  const res = await fetch(`/api/watchlist/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const body = await readJson(res);
    throw new Error(entryError(body));
  }
}

export async function updateWatchlistEntry(
  id: string,
  input: { label: string; chain?: WatchChain; address?: string },
): Promise<WatchlistEntry> {
  const res = await fetch(`/api/watchlist/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await readJson(res);
  if (!res.ok) throw new Error(entryError(body));
  const entry = (body as { entry?: unknown }).entry;
  if (!entry || typeof entry !== "object") {
    throw new Error("The watchlist is unavailable.");
  }
  return entry as WatchlistEntry;
}

export async function updateWatchlistDefault(
  id: string,
  isDefault: boolean,
): Promise<WatchlistEntry> {
  const res = await fetch(`/api/watchlist/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isDefault }),
  });
  const body = await readJson(res);
  if (!res.ok) throw new Error(entryError(body));
  const entry = (body as { entry?: unknown }).entry;
  if (!entry || typeof entry !== "object") {
    throw new Error("The watchlist is unavailable.");
  }
  return entry as WatchlistEntry;
}

/** One row placed into the cached list: a row already on screen keeps its
 * slot and takes the fresh read, and a brand-new address appends after the
 * cards the user is already looking at. */
export function insertWatchlistEntry(
  entries: WatchlistEntry[] | undefined,
  entry: WatchlistEntry,
): WatchlistEntry[] | undefined {
  if (!entries) return entries;
  if (entries.some((row) => row.id === entry.id)) {
    return entries.map((row) => (row.id === entry.id ? entry : row));
  }
  return [...entries, entry];
}

export function useWatchlist(enabled: boolean) {
  const client = useQueryClient();

  const list = useQuery<WatchlistEntry[]>({
    queryKey: WATCHLIST_QUERY_KEY,
    queryFn: fetchWatchlist,
    enabled,
    // A tracked list changes only through this tab; serve it for a minute.
    staleTime: 60_000,
    retry: false,
  });

  const refresh = () =>
    client.invalidateQueries({ queryKey: WATCHLIST_QUERY_KEY });

  const add = useMutation({
    mutationFn: addWatchlistEntry,
    // The row the route returned joins the list before anything else runs.
    // The card therefore paints under the open dialog instead of after it,
    // and the caller's re-read only reconciles the order behind it.
    onSuccess: (entry) => {
      client.setQueryData<WatchlistEntry[]>(WATCHLIST_QUERY_KEY, (old) =>
        insertWatchlistEntry(old, entry),
      );
    },
  });

  const remove = useMutation({
    mutationFn: removeWatchlistEntry,
    onSuccess: () => void refresh(),
  });

  const update = useMutation({
    mutationFn: ({
      id,
      label,
      chain,
      address,
    }: {
      id: string;
      label: string;
      chain?: WatchChain;
      address?: string;
    }) => updateWatchlistEntry(id, { label, chain, address }),
    onSuccess: () => void refresh(),
  });

  const setDefault = useMutation({
    mutationFn: ({ id, isDefault }: { id: string; isDefault: boolean }) =>
      updateWatchlistDefault(id, isDefault),
    onSuccess: () => void refresh(),
  });

  return {
    entries: list.data ?? null,
    isPending: list.isPending,
    error: list.error,
    refresh,
    add: add.mutateAsync,
    addError: add.error,
    isAdding: add.isPending,
    remove: remove.mutateAsync,
    removeError: remove.error,
    isRemoving: remove.isPending,
    update: update.mutateAsync,
    updateError: update.error,
    isUpdating: update.isPending,
    setDefault: setDefault.mutateAsync,
    setDefaultError: setDefault.error,
    isSettingDefault: setDefault.isPending,
  };
}
