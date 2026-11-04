import { randomBytes } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/db/client";
import { intentsAccountId } from "@/lib/intents/balances";
import { normalizeAddress, type AuthChain } from "./challenge";

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const SESSION_COOKIE = "myntle_session";

/** Who signs for the account: an external wallet, or a passkey. */
export type AuthMethod = "wallet" | "passkey";

export type Session = {
  userId: string;
  accountKind: AuthMethod;
  walletId: string | null;
  passkeyId: string | null;
  /** The NEAR Intents account the signer controls. */
  intentsAccountId: string;
  chain: AuthChain;
  address: string;
  createdAt: number;
  expiresAt: number;
};

/** The shape `getSession` reads. Optional columns tolerate a legacy row. */
export type SessionRow = {
  user_id: string;
  wallet_id: string | null;
  passkey_id?: string | null;
  account_kind?: string | null;
  intents_account_id?: string | null;
  chain: string;
  address: string;
  created_at: string;
  expires_at: string;
  revoked_at?: string | null;
};

const AUTH_CHAINS: readonly AuthChain[] = ["evm", "solana", "near"];

/**
 * The Intents account for a session is stored when it was known at sign-in
 * and derived otherwise.
 *
 * Every wallet session created before `004_passkeys.sql` has a null
 * `intents_account_id`, so this is the lazy backfill. A session address that
 * cannot be mapped (a malformed legacy Solana row) falls back to itself rather
 * than becoming an empty string that later code would pass to a quote.
 */
export function resolveIntentsAccountId(
  chain: AuthChain,
  address: string,
  stored?: string | null,
): string {
  if (stored) return stored;
  return intentsAccountId(chain, address) ?? address;
}

/**
 * Maps a stored session row to the in-memory session, or null when the row
 * is not usable. Pure so the wallet compatibility rules can be tested without
 * a database.
 */
export function sessionFromRow(row: SessionRow, now = Date.now()): Session | null {
  if (row.revoked_at) return null;

  const createdAt = new Date(row.created_at).getTime();
  const expiresAt = new Date(row.expires_at).getTime();
  if (!Number.isFinite(createdAt)) return null;
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return null;

  const chain = row.chain as AuthChain;
  if (!AUTH_CHAINS.includes(chain)) return null;

  // Rows written before the migration, and wallet rows after it, are wallets.
  const accountKind: AuthMethod =
    row.account_kind === "passkey" ? "passkey" : "wallet";
  const passkeyId = row.passkey_id ?? null;
  if (accountKind === "passkey" && !passkeyId) return null;

  return {
    userId: row.user_id,
    accountKind,
    walletId: row.wallet_id ?? null,
    passkeyId,
    intentsAccountId: resolveIntentsAccountId(
      chain,
      row.address,
      row.intents_account_id,
    ),
    chain,
    address: row.address,
    createdAt,
    expiresAt,
  };
}

/** The cookie settings shared by the wallet and passkey sign-in routes. */
export function sessionCookieOptions(expiresAt: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
    expires: new Date(expiresAt),
  };
}

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

/**
 * Creates a session for a passkey-owned account.
 *
 * The user comes from the passkey row rather than the request: the signer is
 * the account, and a client must not be able to point a session at another
 * user's id. `createSession` remains the wallet entry point and is unchanged.
 */
export async function createPasskeySession(args: {
  chain: "near";
  address: string;
  passkeyId: string;
  intentsAccountId: string;
}): Promise<{ id: string; expiresAt: number }> {
  const sb = getSupabaseAdmin();
  const { data: passkey, error } = await sb
    .from("passkey_accounts")
    .select("user_id")
    .eq("id", args.passkeyId)
    .is("revoked_at", null)
    .single();
  if (error || !passkey) throw new Error("The sign-in could not complete.");

  const id = randomBytes(32).toString("hex");
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;

  const { error: insertError } = await sb.from("sessions").insert({
    id,
    user_id: passkey.user_id as string,
    wallet_id: null,
    passkey_id: args.passkeyId,
    account_kind: "passkey",
    chain: args.chain,
    address: args.address,
    intents_account_id: args.intentsAccountId,
    expires_at: new Date(expiresAt).toISOString(),
  });
  if (insertError) throw new Error("The sign-in could not complete.");

  return { id, expiresAt };
}

const SESSION_COLUMNS =
  "user_id, wallet_id, passkey_id, account_kind, intents_account_id, chain, address, created_at, expires_at, revoked_at";

const LEGACY_SESSION_COLUMNS =
  "user_id, wallet_id, chain, address, created_at, expires_at, revoked_at";

/**
 * True when the query failed because `004_passkeys.sql` has not been
 * applied yet. PostgREST reports a missing column as 42703 or PGRST204.
 *
 * The fallback exists so deploying this code cannot sign every wallet user
 * out before the migration runs. The passkey routes stay disabled until the
 * migration lands, but the wallet path keeps working.
 */
function missingPasskeyColumns(error: { code?: string } | null): boolean {
  return error?.code === "42703" || error?.code === "PGRST204";
}

export async function getSession(id: string): Promise<Session | null> {
  const sb = getSupabaseAdmin();
  const first = await sb
    .from("sessions")
    .select(SESSION_COLUMNS)
    .eq("id", id)
    .single();
  let data = first.data as SessionRow | null;
  let error = first.error;

  if (error && missingPasskeyColumns(error)) {
    const legacy = await sb
      .from("sessions")
      .select(LEGACY_SESSION_COLUMNS)
      .eq("id", id)
      .single();
    data = legacy.data
      ? ({
          ...(legacy.data as Omit<
            SessionRow,
            "passkey_id" | "account_kind" | "intents_account_id"
          >),
          account_kind: "wallet",
          passkey_id: null,
          intents_account_id: null,
        } as SessionRow)
      : null;
    error = legacy.error;
  }

  if (error || !data) return null;

  const session = sessionFromRow(data as SessionRow);
  if (!session) return null;

  // A revoked signer must not keep a live session. This is the only extra
  // read a passkey session costs, and the wallet path never runs it.
  if (session.accountKind === "passkey") {
    if (!session.passkeyId) return null;
    const { data: passkey, error: passkeyError } = await sb
      .from("passkey_accounts")
      .select("revoked_at")
      .eq("id", session.passkeyId)
      .single();
    if (passkeyError || !passkey || passkey.revoked_at) return null;
  }

  // Best-effort activity touch. Never blocks the request.
  void sb
    .from("sessions")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", id)
    .then(() => undefined);

  return session;
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
