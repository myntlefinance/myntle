/**
 * Client-side User-Session for NEAR Intents private reads.
 *
 * The browser talks to 1Click directly; the server never sees these tokens.
 * That is the point: private balances stay between the user and 1Click, and
 * nothing server-side can leak, lose, or abuse them. Memory holds the live
 * access token, localStorage holds the refresh token across reloads. A page
 * reload loses at most the 15-minute access token, which is re-minted
 * silently — never a re-sign.
 */

import { useSyncExternalStore } from "react";

export const SUPER_UNLOCK_EVENT = "myntle:super-unlock";
export const SUPER_LOCK_EVENT = "myntle:super-lock";
export const SUPER_CONTINUE_EVENT = "myntle:super-continue";
/** The unlock dialog closed without a token, and names the card that asked. */
export const SUPER_CANCEL_EVENT = "myntle:super-cancel";
/**
 * The unlock dialog is gone. The read may already have finished behind it;
 * this is when the portfolio is allowed to reveal what it fetched.
 */
export const SUPER_CLOSED_EVENT = "myntle:super-closed";

export function notifySuperUnlock(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SUPER_UNLOCK_EVENT));
  }
}

export function notifySuperClosed(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SUPER_CLOSED_EVENT));
  }
}

export function notifySuperLock(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SUPER_LOCK_EVENT));
  }
}

/** Reactive lock state for a connected wallet. Null while no wallet picked. */
export function useSuperUnlocked(
  chain?: string | null,
  address?: string | null,
): boolean | null {
  return useSyncExternalStore(
    (notify) => {
      if (typeof window === "undefined") return () => {};
      window.addEventListener(SUPER_UNLOCK_EVENT, notify);
      window.addEventListener(SUPER_LOCK_EVENT, notify);
      return () => {
        window.removeEventListener(SUPER_UNLOCK_EVENT, notify);
        window.removeEventListener(SUPER_LOCK_EVENT, notify);
      };
    },
    () => (chain && address ? isSuperUnlocked(chain, address) : null),
    () => null,
  );
}

const ONE_CLICK =
  process.env.NEXT_PUBLIC_ONE_CLICK_BASE_URL ?? "https://1click.chaindefuser.com";

/** localStorage never holds this: refresh tokens mint access on their own. */
const ACCESS_SKEW_MS = 60_000;

/**
 * The signer key a User-Session is stored under.
 *
 * `passkey` is reserved for the passkey account's own empty-intent session; a
 * wallet session keeps its chain key, so every existing entry still resolves.
 */
export type IntentsChain = "evm" | "solana" | "near" | "passkey";

type StoredIntentsSession = {
  v: 1;
  chain: IntentsChain;
  address: string;
  /** Memory only. Never written to localStorage. */
  accessToken: string | null;
  refreshToken: string;
  obtainedAt: number;
  expiresIn: number;
  refreshExpiresIn: number;
};

const memory = new Map<string, StoredIntentsSession>();

function keyFor(chain: string, address: string): string {
  return `myntle:intents-session:${chain}:${address.toLowerCase()}`;
}

function readStored(chain: string, address: string): StoredIntentsSession | null {
  const key = keyFor(chain, address);
  const mem = memory.get(key);
  if (mem) return mem;
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredIntentsSession;
    if (
      parsed?.v !== 1 ||
      typeof parsed.refreshToken !== "string" ||
      typeof parsed.obtainedAt !== "number" ||
      typeof parsed.expiresIn !== "number" ||
      typeof parsed.refreshExpiresIn !== "number"
    ) {
      return null;
    }
    // A reload loses the access token by design; the refresh token mints a
    // new one on the next read.
    const restored: StoredIntentsSession = { ...parsed, accessToken: null };
    memory.set(key, restored);
    return restored;
  } catch {
    return null;
  }
}

export function saveIntentsSession(entry: {
  chain: IntentsChain;
  address: string;
  accessToken: string;
  refreshToken: string;
  obtainedAt?: number;
  expiresIn: number;
  refreshExpiresIn: number;
}): void {
  const stored: StoredIntentsSession = {
    v: 1,
    chain: entry.chain,
    address: entry.address,
    accessToken: entry.accessToken,
    refreshToken: entry.refreshToken,
    obtainedAt: entry.obtainedAt ?? Date.now(),
    expiresIn: entry.expiresIn,
    refreshExpiresIn: entry.refreshExpiresIn,
  };
  memory.set(keyFor(entry.chain, entry.address), stored);
  if (typeof window === "undefined") return;
  try {
    // localStorage keeps the refresh token only. The access token lives in
    // memory for its 15 minutes and is re-minted silently after a reload.
    const persisted = {
      v: stored.v,
      chain: stored.chain,
      address: stored.address,
      refreshToken: stored.refreshToken,
      obtainedAt: stored.obtainedAt,
      expiresIn: stored.expiresIn,
      refreshExpiresIn: stored.refreshExpiresIn,
    };
    window.localStorage.setItem(
      keyFor(entry.chain, entry.address),
      JSON.stringify(persisted),
    );
  } catch {
    // Private mode or quota: memory still covers this page lifetime.
  }
}

function accessLive(s: StoredIntentsSession, now: number): boolean {
  return (
    typeof s.accessToken === "string" &&
    s.accessToken.length > 0 &&
    now < s.obtainedAt + s.expiresIn * 1000 - ACCESS_SKEW_MS
  );
}

function refreshLive(s: StoredIntentsSession, now: number): boolean {
  return now < s.obtainedAt + s.refreshExpiresIn * 1000;
}

/** Unlocked means a live refresh token exists — reads can proceed silently. */
export function isSuperUnlocked(
  chain?: string | null,
  address?: string | null,
  now = Date.now(),
): boolean {
  if (!chain || !address) return false;
  const s = readStored(chain, address);
  return !!s && refreshLive(s, now);
}

/**
 * A refresh either yields a token, proves the session is dead, or says the
 * service could not be reached. The distinction matters: a network outage
 * must not be rendered as "your account is locked", or the user re-signs to
 * fix a problem that was never theirs.
 */
type TokenResult =
  | { ok: true; token: string }
  | { ok: false; reason: "locked" | "error" };

async function mintAccess(s: StoredIntentsSession): Promise<TokenResult> {
  try {
    const res = await fetch(`${ONE_CLICK}/v0/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: s.refreshToken }),
    });
    // A refused refresh token is a dead session. A throttled or broken
    // service is not, and the caller shows it as a read error instead.
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: "locked" };
    }
    if (!res.ok) return { ok: false, reason: "error" };
    const data = (await res.json()) as {
      accessToken?: string;
      expiresIn?: number;
    };
    if (!data.accessToken || typeof data.expiresIn !== "number") {
      return { ok: false, reason: "error" };
    }
    saveIntentsSession({
      ...s,
      accessToken: data.accessToken,
      obtainedAt: Date.now(),
      expiresIn: data.expiresIn,
    });
    return { ok: true, token: data.accessToken };
  } catch {
    return { ok: false, reason: "error" };
  }
}

/**
 * A live access token, refreshing silently when needed.
 * Null means locked: show the unlock dialog, not an error.
 */
export async function getValidAccessToken(
  chain: string,
  address: string,
): Promise<string | null> {
  const now = Date.now();
  const s = readStored(chain, address);
  if (!s) return null;
  if (accessLive(s, now) && s.accessToken) return s.accessToken;
  if (!refreshLive(s, now)) return null;
  const minted = await mintAccess(s);
  return minted.ok ? minted.token : null;
}

export type PrivateBalances = {
  balances: Array<{
    tokenId: string;
    available: string;
    source?: string;
  }>;
};

/**
 * Private balances for the user's own session. Direct browser→1Click;
 * the server never sees the token.
 *
 * Three outcomes, not two: locked means there is no session or the service
 * refused it, error means the service could not be reached, and success
 * carries the ledger. A session that is refused even after a fresh token is
 * forgotten here, so every surface agrees it is locked and offers the
 * unlock action instead of a card that says "unlocked" over masked rows.
 */
export async function fetchPrivateBalances(
  chain: string,
  address: string,
  tokenIds?: string,
): Promise<
  | { ok: true; balances: PrivateBalances["balances"] }
  | { ok: false; reason: "locked" | "error" }
> {
  const now = Date.now();
  const stored = readStored(chain, address);
  if (!stored || !refreshLive(stored, now)) {
    return { ok: false, reason: "locked" };
  }

  let token = accessLive(stored, now) && stored.accessToken
    ? stored.accessToken
    : null;
  if (!token) {
    const minted = await mintAccess(stored);
    if (!minted.ok) {
      // A refused refresh token is proof the session is dead. Forget it so
      // the card offers the unlock action instead of a green lie.
      if (minted.reason === "locked") {
        clearIntentsSession(chain, address);
        notifySuperLock();
      }
      return { ok: false, reason: minted.reason };
    }
    token = minted.token;
  }

  const query = tokenIds ? `?tokenIds=${encodeURIComponent(tokenIds)}` : "";
  const attempt = async (bearer: string) =>
    fetch(`${ONE_CLICK}/v0/account/balances${query}`, {
      headers: { authorization: `Bearer ${bearer}` },
    });

  try {
    let res = await attempt(token);
    if (res.status === 401) {
      // The token died between check and use. One silent refresh, one retry.
      const latest = readStored(chain, address) ?? stored;
      if (!refreshLive(latest, Date.now())) {
        clearIntentsSession(chain, address);
        notifySuperLock();
        return { ok: false, reason: "locked" };
      }
      const minted = await mintAccess(latest);
      if (!minted.ok) {
        if (minted.reason === "locked") {
          clearIntentsSession(chain, address);
          notifySuperLock();
        }
        return { ok: false, reason: minted.reason };
      }
      res = await attempt(minted.token);
    }
    if (res.status === 401) {
      // A freshly minted token was refused too. This session is not usable;
      // forget it so nothing keeps claiming the account is unlocked.
      clearIntentsSession(chain, address);
      notifySuperLock();
      return { ok: false, reason: "locked" };
    }
    if (!res.ok) return { ok: false, reason: "error" };
    const data = (await res.json()) as PrivateBalances;
    return { ok: true, balances: data.balances ?? [] };
  } catch {
    return { ok: false, reason: "error" };
  }
}

/** Forgets one wallet's session (per-wallet disconnect). */
export function clearIntentsSession(chain: string, address: string): void {
  memory.delete(keyFor(chain, address));
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(keyFor(chain, address));
  } catch {
    // Nothing stored, nothing to forget.
  }
}

/**
 * Locks one wallet's super account: drops the live access token from memory
 * and the refresh token from localStorage, then tells every listener so the
 * menu, the assistant context, and the next private read all see it locked.
 */
export function lockSuperAccount(chain: string, address: string): void {
  clearIntentsSession(chain, address);
  notifySuperLock();
}

/** Forgets every stored session (Myntle sign-out). */
export function clearAllIntentsSessions(): void {
  memory.clear();
  if (typeof window === "undefined") return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (k?.startsWith("myntle:intents-session:")) doomed.push(k);
    }
    for (const k of doomed) window.localStorage.removeItem(k);
  } catch {
    // Memory is already clear; storage follows best-effort.
  }
  notifySuperLock();
}
