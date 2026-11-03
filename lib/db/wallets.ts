import { getSupabaseAdmin } from "./client";
import { normalizeAddress, type AuthChain } from "@/lib/auth/challenge";

/**
 * Finds the user behind one connected wallet, if they ever signed in.
 *
 * Read-only: unlike sign-in, this never creates a user or wallet row, so a
 * read from a fresh address returns nothing instead of provisioning one.
 */
export async function findUserIdByWallet(
  chain: AuthChain,
  address: string,
): Promise<string | null> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("wallets")
    .select("user_id")
    .eq("chain", chain)
    .eq("address", normalizeAddress(chain, address))
    .maybeSingle();
  if (error || !data) return null;
  return (data as { user_id: string }).user_id;
}
