import { randomBytes } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/db/client";
import { normalizeAddress, type AuthChain } from "./challenge";

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const SESSION_COOKIE = "myntle_session";

export type Session = {
  userId: string;
  walletId: string | null;
  chain: AuthChain;
  address: string;
  createdAt: number;
  expiresAt: number;
};

async function findOrCreateUserAndWallet(
  chain: AuthChain,
  address: string,
): Promise<{ userId: string; walletId: string }> {
  const sb = getSupabaseAdmin();
  const normalized = normalizeAddress(chain, address);

  const { data: existing } = await sb
    .from("wallets")
    .select("id, user_id")
    .eq("chain", chain)
    .eq("address", normalized)
    .single();
  if (existing) {
    return { userId: existing.user_id as string, walletId: existing.id as string };
  }

  const { data: user, error: userError } = await sb
    .from("users")
    .insert({})
    .select("id")
    .single();
  if (userError || !user) throw new Error("The sign-in could not complete.");

  const { data: wallet, error: walletError } = await sb
    .from("wallets")
    .insert({ user_id: user.id, chain, address: normalized })
    .select("id")
    .single();
  if (walletError || !wallet) {
    // Wallet raced another request. Re-read the winner.
    const { data: winner } = await sb
      .from("wallets")
      .select("id, user_id")
      .eq("chain", chain)
      .eq("address", normalized)
      .single();
    if (winner) {
      return { userId: winner.user_id as string, walletId: winner.id as string };
    }
    throw new Error("The sign-in could not complete.");
  }

  return { userId: user.id as string, walletId: wallet.id as string };
}

export async function createSession(
  chain: AuthChain,
  address: string,
): Promise<{ id: string; expiresAt: number }> {
  const sb = getSupabaseAdmin();
  const { userId, walletId } = await findOrCreateUserAndWallet(chain, address);

  const id = randomBytes(32).toString("hex");
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;

  const { error } = await sb.from("sessions").insert({
    id,
    user_id: userId,
    wallet_id: walletId,
    chain,
    address: normalizeAddress(chain, address),
    expires_at: new Date(expiresAt).toISOString(),
  });
  if (error) throw new Error("The sign-in could not complete.");

  return { id, expiresAt };
}

export async function getSession(id: string): Promise<Session | null> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("sessions")
    .select("user_id, wallet_id, chain, address, created_at, expires_at, revoked_at")
    .eq("id", id)
    .single();
  if (error || !data) return null;
  if (data.revoked_at) return null;
  if (new Date(data.expires_at).getTime() <= Date.now()) return null;

  // Best-effort activity touch. Never blocks the request.
  void sb
    .from("sessions")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", id)
    .then(() => undefined);

  return {
    userId: data.user_id as string,
    walletId: (data.wallet_id as string | null) ?? null,
    chain: data.chain as AuthChain,
    address: data.address as string,
    createdAt: new Date(data.created_at).getTime(),
    expiresAt: new Date(data.expires_at).getTime(),
  };
}

export async function revokeSession(id: string): Promise<void> {
  const sb = getSupabaseAdmin();
  await sb
    .from("sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id);
}

export async function requireSession(req: Request): Promise<Session | null> {
  const cookie = req.headers.get("cookie") ?? "";
  const match = cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (!match) return null;
  const id = decodeURIComponent(match.slice(SESSION_COOKIE.length + 1));
  if (!id) return null;
  return getSession(id);
}
