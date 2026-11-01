import { randomBytes } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/db/client";

export type AuthChain = "evm" | "solana" | "near";

export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export function normalizeAddress(chain: AuthChain, address: string): string {
  return chain === "evm" ? address.toLowerCase() : address;
}

export function buildMessage(args: {
  chain: AuthChain;
  address: string;
  nonceHex: string;
  expiresAt: number;
}): string {
  return (
    `Sign in to Myntle\n` +
    `\n` +
    `Chain: ${args.chain}\n` +
    `Address: ${args.address}\n` +
    `Nonce: ${args.nonceHex}\n` +
    `Expires: ${new Date(args.expiresAt).toISOString()}`
  );
}

export async function createChallenge(
  chain: AuthChain,
  address: string,
  recipient?: string,
): Promise<{
  message: string;
  nonce: string;
  expiresAt: number;
  recipient?: string;
}> {
  const now = Date.now();
  const nonceHex = randomBytes(32).toString("hex");
  const expiresAt = now + CHALLENGE_TTL_MS;
  const normalized = normalizeAddress(chain, address);

  const sb = getSupabaseAdmin();
  const { error } = await sb.from("challenges").insert({
    nonce_hex: nonceHex,
    chain,
    address: normalized,
    recipient: chain === "near" ? (recipient ?? null) : null,
    expires_at: new Date(expiresAt).toISOString(),
  });
  if (error) throw new Error("The sign-in request could not start.");

  // Best-effort cleanup of old challenges. Never blocks login.
  void sb
    .from("challenges")
    .delete()
    .lt("expires_at", new Date(now - 60_000).toISOString())
    .then(() => undefined);

  return {
    message: buildMessage({ chain, address, nonceHex, expiresAt }),
    nonce: nonceHex,
    expiresAt,
    ...(chain === "near" && recipient ? { recipient } : {}),
  };
}

export async function consumeChallenge(
  nonceHex: string,
  chain: AuthChain,
  address: string,
): Promise<{ expiresAt: number; recipient?: string } | null> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("challenges")
    .select("chain, address, recipient, expires_at, consumed_at")
    .eq("nonce_hex", nonceHex)
    .single();
  if (error || !data) return null;
  if (data.consumed_at) return null;
  if (data.chain !== chain) return null;
  if (data.address !== normalizeAddress(chain, address)) return null;

  const expiresAt = new Date(data.expires_at).getTime();
  if (expiresAt <= Date.now()) return null;

  const { data: claimed, error: claimError } = await sb
    .from("challenges")
    .update({ consumed_at: new Date().toISOString() })
    .eq("nonce_hex", nonceHex)
    .is("consumed_at", null)
    .select("nonce_hex")
    .single();
  if (claimError || !claimed) return null;

  return {
    expiresAt,
    ...(data.recipient ? { recipient: data.recipient as string } : {}),
  };
}
