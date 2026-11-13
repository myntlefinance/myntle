import { PublicKey } from "near-api-js";
import type { Session } from "@/lib/auth/session";
import {
  getNearSetupGrant,
  updateNearSetupGrant,
  type NearSetupGrant,
} from "@/lib/db/near-setup";
import type { NearSetupState } from "@/lib/intents/near-setup";
import {
  getNearBalance,
  isIntentsKeyRegistered,
  isNearFullAccessKey,
  isNearImplicitAccount,
  isNearTransactionFinal,
  nearSetupFaucetAccount,
  nearSetupGrantYocto,
  nearSetupMinBalanceYocto,
  yoctoToNear,
} from "@/lib/near/intents-keys";

/**
 * Server-side truth for NEAR super-account setup.
 *
 * The browser may send the key its wallet currently holds; the server accepts
 * it only when it is the key verified at sign-in or a full-access key on the
 * signed-in account. The account itself always comes from the session.
 */

const STALE_PENDING_MS = 90_000;

function normalizePublicKey(value: string): string | null {
  try {
    return PublicKey.from(value).toString();
  } catch {
    return null;
  }
}

export type ResolvedSetupKey =
  | { key: string }
  | { needsKey: true }
  | { badKey: true };

/** Reads the optional wallet key the browser sends with a setup request. */
export async function readSetupPublicKey(
  req: Request,
): Promise<string | null> {
  try {
    const body = (await req.json()) as { publicKey?: unknown };
    return typeof body.publicKey === "string"
      ? body.publicKey.trim() || null
      : null;
  } catch {
    return null;
  }
}

export async function resolveNearSetupKey(
  session: Session,
  provided?: string | null,
): Promise<ResolvedSetupKey> {
  const stored = session.publicKey
    ? normalizePublicKey(session.publicKey)
    : null;
  const raw = provided?.trim() || session.publicKey?.trim() || "";
  if (!raw) return { needsKey: true };

  const candidate = normalizePublicKey(raw);
  if (!candidate) return { badKey: true };

  // The sign-in already proved this exact key for this account.
  if (stored && candidate === stored) return { key: candidate };

  // A new key is accepted only when it is a full-access key on the same
  // account. This covers an older session and a wallet that rotated keys.
  // Wallets can expose a different, non-signing key here; fall back to the
  // key the sign-in already verified instead of blocking setup.
  const onAccount = await isNearFullAccessKey(session.address, candidate);
  if (onAccount) return { key: candidate };
  return stored ? { key: stored } : { badKey: true };
}

async function refreshGrant(grant: NearSetupGrant): Promise<NearSetupGrant> {
  if (grant.status === "pending") {
    const age = Date.now() - Date.parse(grant.createdAt);
    if (Number.isFinite(age) && age > STALE_PENDING_MS) {
      await updateNearSetupGrant(grant.id, {
        status: "failed",
        error: "The network-fee transfer timed out.",
      });
      return { ...grant, status: "failed", error: "The network-fee transfer timed out." };
    }
  }

  if (grant.status === "sent" && grant.txHash) {
    const faucet = nearSetupFaucetAccount();
    if (faucet && (await isNearTransactionFinal(grant.txHash, faucet))) {
      await updateNearSetupGrant(grant.id, { status: "final" });
      return { ...grant, status: "final" };
    }
  }

  return grant;
}

/**
 * The setup state for a signed-in session.
 *
 * A passkey session, an EVM/Solana wallet, and an implicit NEAR account all
 * return `needsSetup: false`; only a named NEAR wallet can need the one-time
 * registration.
 */
export async function getNearSetupState(
  session: Session,
  providedKey?: string | null,
): Promise<NearSetupState> {
  if (session.chain !== "near" || session.accountKind !== "wallet") {
    return { needsSetup: false, registered: false };
  }
  if (isNearImplicitAccount(session.address)) {
    return { needsSetup: false, registered: false, implicit: true };
  }

  const resolved = await resolveNearSetupKey(session, providedKey);
  if ("needsKey" in resolved) {
    return { needsSetup: true, registered: false, needsKey: true };
  }
  if ("badKey" in resolved) {
    return { needsSetup: true, registered: false, badKey: true };
  }

  const publicKey = resolved.key;
  const registered = await isIntentsKeyRegistered(session.address, publicKey);
  if (registered) {
    return { needsSetup: false, registered: true, publicKey };
  }

  let grant = await getNearSetupGrant(session.address, publicKey);
  if (grant) grant = await refreshGrant(grant);

  const balance = await getNearBalance(session.address);
  const hasGas = balance >= BigInt(nearSetupMinBalanceYocto());
  const amount = grant?.amount ?? nearSetupGrantYocto();

  return {
    needsSetup: true,
    registered: false,
    publicKey,
    amountNear: yoctoToNear(amount),
    amountYocto: amount,
    balanceYocto: balance.toString(),
    hasGas,
    // Once a grant row exists, a zero balance never triggers another send.
    needsFunding: !grant && !hasGas,
    grant: grant
      ? {
          status: grant.status,
          txHash: grant.txHash,
          error: grant.error,
        }
      : null,
  };
}
