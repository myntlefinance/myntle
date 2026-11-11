import { getSupabaseAdmin } from "./client";
import type { WatchChain } from "@/lib/wallet/addresses";

export type WatchedAddressRow = {
  id: string;
  user_id: string;
  chain: WatchChain;
  address: string;
  label: string | null;
  is_default: boolean;
  created_at: string;
};

const COLUMNS = "id, user_id, chain, address, label, is_default, created_at";

/**
 * The watchlist: addresses the user tracks read-only.
 *
 * Every query is scoped by the session's user id; the table carries RLS with
 * no permissive policies, so the service role plus this scope is the whole
 * access story. EVM addresses arrive checksummed from the route, so one
 * account is one row per user. The default row lists first, so a fresh
 * visit opens to it without any further read.
 */
export async function listWatchedAddresses(
  userId: string,
): Promise<WatchedAddressRow[]> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("watched_addresses")
    .select(COLUMNS)
    .eq("user_id", userId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error("The watchlist could not be read.");
  return (data ?? []) as WatchedAddressRow[];
}

/**
 * Tracks an address. A duplicate add stays one row: the unique constraint
 * wins the race and the existing row is returned instead.
 */
export async function addWatchedAddress(args: {
  userId: string;
  chain: WatchChain;
  address: string;
  label: string;
}): Promise<WatchedAddressRow> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("watched_addresses")
    .insert({
      user_id: args.userId,
      chain: args.chain,
      address: args.address,
      label: args.label,
    })
    .select(COLUMNS)
    .single();
  if (!error && data) return data as WatchedAddressRow;
  if (error && error.code === "23505") {
    const { data: existing, error: readError } = await sb
      .from("watched_addresses")
      .select(COLUMNS)
      .eq("user_id", args.userId)
      .eq("chain", args.chain)
      .eq("address", args.address)
      .single();
    if (!readError && existing) return existing as WatchedAddressRow;
  }
  throw new Error("The address could not be tracked.");
}

/** Removes one row, and only the caller's own row. */
export async function removeWatchedAddress(
  userId: string,
  id: string,
): Promise<boolean> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("watched_addresses")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .select("id")
    .single();
  if (error || !data) return false;
  return true;
}

/** One row by id, or null. Only the caller's own row. */
export async function getWatchedAddress(args: {
  userId: string;
  id: string;
}): Promise<WatchedAddressRow | null> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("watched_addresses")
    .select(COLUMNS)
    .eq("id", args.id)
    .eq("user_id", args.userId)
    .single();
  if (error || !data) return null;
  return data as WatchedAddressRow;
}

/** One row by account, or null. The same address on two chains is two rows. */
export async function findWatchedAddress(args: {
  userId: string;
  chain: WatchChain;
  address: string;
}): Promise<WatchedAddressRow | null> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("watched_addresses")
    .select(COLUMNS)
    .eq("user_id", args.userId)
    .eq("chain", args.chain)
    .eq("address", args.address)
    .single();
  if (error || !data) return null;
  return data as WatchedAddressRow;
}

/** Renames a row, and moves it when the chain or address changed. Only the
 * caller's own row. A move onto an already-tracked account is rejected by
 * the caller, never merged: the unique constraint wins the race instead. */
export async function updateWatchedAddress(args: {
  userId: string;
  id: string;
  label: string;
  chain?: WatchChain;
  address?: string;
}): Promise<WatchedAddressRow | null> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("watched_addresses")
    .update({
      label: args.label,
      ...(args.chain ? { chain: args.chain } : {}),
      ...(args.address ? { address: args.address } : {}),
    })
    .eq("id", args.id)
    .eq("user_id", args.userId)
    .select(COLUMNS)
    .single();
  if (error || !data) return null;
  return data as WatchedAddressRow;
}

/**
 * Marks one row as the default a fresh visit opens to, or clears it
 * with a null id. Only the caller's own row. Clearing runs first so
 * the partial unique index never sees two defaults; a lost race
 * surfaces as a failed set, never as two rows flagged.
 */
export async function setDefaultWatchedAddress(args: {
  userId: string;
  id: string | null;
}): Promise<WatchedAddressRow | null> {
  const sb = getSupabaseAdmin();
  const cleared = await sb
    .from("watched_addresses")
    .update({ is_default: false })
    .eq("user_id", args.userId)
    .eq("is_default", true)
    .select("id");
  if (cleared.error) return null;
  if (args.id === null) return null;
  const { data, error } = await sb
    .from("watched_addresses")
    .update({ is_default: true })
    .eq("id", args.id)
    .eq("user_id", args.userId)
    .select(COLUMNS)
    .single();
  if (error || !data) return null;
  return data as WatchedAddressRow;
}
