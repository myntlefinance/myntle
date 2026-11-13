import { getSupabaseAdmin } from "@/lib/db/client";
import type { NearSetupGrantStatus } from "@/lib/intents/near-setup";

/**
 * The durable record of the one-time NEAR network-fee grant.
 *
 * `unique (account_id, public_key)` is the hard guarantee: no address/key pair
 * is ever funded twice, even if the account later spends the balance and
 * comes back empty. The row is written before the transfer is sent, so a
 * reload or a dismissed dialog resumes the same state instead of starting a
 * second grant.
 */

export type NearSetupGrant = {
  id: string;
  userId: string | null;
  accountId: string;
  publicKey: string;
  amount: string;
  status: NearSetupGrantStatus;
  txHash: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

type GrantRow = {
  id: string;
  user_id: string | null;
  account_id: string;
  public_key: string;
  amount: string;
  status: NearSetupGrantStatus;
  tx_hash: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

function mapGrant(row: GrantRow): NearSetupGrant {
  return {
    id: row.id,
    userId: row.user_id,
    accountId: row.account_id,
    publicKey: row.public_key,
    amount: row.amount,
    status: row.status,
    txHash: row.tx_hash,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getNearSetupGrant(
  accountId: string,
  publicKey: string,
): Promise<NearSetupGrant | null> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("near_setup_grants")
    .select("*")
    .eq("account_id", accountId)
    .eq("public_key", publicKey)
    .maybeSingle();
  if (error) throw new Error("The NEAR setup record could not be read.");
  return data ? mapGrant(data as GrantRow) : null;
}

/**
 * Creates the grant row once. Returns the winner when another request raced
 * this one. A unique violation is the only error treated as "already exists";
 * any other write failure is surfaced.
 */
export async function createNearSetupGrant(input: {
  userId: string | null;
  accountId: string;
  publicKey: string;
  amount: string;
}): Promise<{ created: boolean; grant: NearSetupGrant }> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("near_setup_grants")
    .insert({
      user_id: input.userId,
      account_id: input.accountId,
      public_key: input.publicKey,
      amount: input.amount,
      status: "pending",
    })
    .select("*")
    .maybeSingle();

  if (!error && data) {
    return { created: true, grant: mapGrant(data as GrantRow) };
  }
  if (error && error.code !== "23505") {
    throw new Error("The NEAR setup record could not be written.");
  }

  const existing = await getNearSetupGrant(input.accountId, input.publicKey);
  if (!existing) throw new Error("The NEAR setup record could not be read.");
  return { created: false, grant: existing };
}

export async function updateNearSetupGrant(
  id: string,
  patch: Partial<{
    status: NearSetupGrantStatus;
    txHash: string | null;
    error: string | null;
  }>,
): Promise<void> {
  const sb = getSupabaseAdmin();
  const row: Record<string, unknown> = {};
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.txHash !== undefined) row.tx_hash = patch.txHash;
  if (patch.error !== undefined) row.error = patch.error;
  if (Object.keys(row).length === 0) return;

  const { error } = await sb
    .from("near_setup_grants")
    .update(row)
    .eq("id", id);
  if (error) throw new Error("The NEAR setup record could not be updated.");
}

export async function countNearSetupGrantsSince(
  sinceIso: string,
): Promise<number> {
  const sb = getSupabaseAdmin();
  const { count, error } = await sb
    .from("near_setup_grants")
    .select("id", { count: "exact", head: true })
    .gte("created_at", sinceIso);
  if (error) throw new Error("The NEAR setup budget could not be read.");
  return count ?? 0;
}
