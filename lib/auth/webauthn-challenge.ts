/**
 * One-time WebAuthn challenges.
 *
 * Registration and login are both unauthenticated, so the only thing that
 * binds a ceremony response to this server is the challenge row. It is
 * consumed with a single conditional `UPDATE ... RETURNING`: the row is
 * claimed only if it is the expected kind, unused, and unexpired. A second
 * request gets no row, which is what makes the challenge single-use even when
 * two tabs race.
 *
 * This is deliberately separate from the wallet `challenges` table, which has
 * chain/address columns and a different consume contract.
 */

import { getSupabaseAdmin } from "@/lib/db/client";

export const WEBAUTHN_CHALLENGE_TTL_MS = 5 * 60 * 1000;

export type WebAuthnChallengeKind = "registration" | "authentication";

export async function createWebAuthnChallenge(args: {
  kind: WebAuthnChallengeKind;
  challenge: string;
  userId?: string | null;
}): Promise<{ id: string; expiresAt: number }> {
  const now = Date.now();
  const expiresAt = now + WEBAUTHN_CHALLENGE_TTL_MS;
  const sb = getSupabaseAdmin();

  const { data, error } = await sb
    .from("webauthn_challenges")
    .insert({
      kind: args.kind,
      user_id: args.userId ?? null,
      challenge: args.challenge,
      expires_at: new Date(expiresAt).toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) throw new Error("The passkey request could not start.");

  // Best-effort cleanup of old rows. Never blocks the ceremony.
  void sb
    .from("webauthn_challenges")
    .delete()
    .lt("expires_at", new Date(now - 60_000).toISOString())
    .then(() => undefined);

  return { id: data.id as string, expiresAt };
}

/**
 * Claims a challenge and returns its value, or null when it is unknown,
 * already used, expired, or of the wrong kind. The caller must not reveal
 * which of those it was.
 */
export async function consumeWebAuthnChallenge(
  id: string,
  kind: WebAuthnChallengeKind,
): Promise<string | null> {
  const sb = getSupabaseAdmin();
  const nowIso = new Date().toISOString();

  const { data, error } = await sb
    .from("webauthn_challenges")
    .update({ consumed_at: nowIso })
    .eq("id", id)
    .eq("kind", kind)
    .is("consumed_at", null)
    .gt("expires_at", nowIso)
    .select("challenge")
    .single();
  if (error || !data) return null;
  return data.challenge as string;
}
