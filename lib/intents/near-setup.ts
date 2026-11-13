/**
 * Shared types and browser calls for NEAR super-account setup.
 *
 * The browser never decides whether setup is needed: every call is
 * session-authenticated and the server re-reads `intents.near`. These helpers
 * only carry the request and the state back to the dialog.
 */

export type NearSetupGrantStatus =
  | "pending"
  | "sent"
  | "final"
  | "failed"
  | "registered";

export type NearSetupGrantState = {
  status: NearSetupGrantStatus;
  txHash: string | null;
  error: string | null;
};

export type NearSetupState = {
  /** False for implicit accounts, passkeys, and already-registered keys. */
  needsSetup: boolean;
  registered: boolean;
  /** A 64-hex NEAR account is implicit and needs no registration. */
  implicit?: boolean;
  /** The key the setup will register. Absent when the session has no key. */
  publicKey?: string | null;
  /** The session predates the stored key; sign in again. */
  needsKey?: boolean;
  /** The key provided by the browser is not a full-access key on the account. */
  badKey?: boolean;
  amountNear?: string;
  amountYocto?: string;
  balanceYocto?: string;
  hasGas?: boolean;
  /** Send the one-time network fee. False once a grant row exists. */
  needsFunding?: boolean;
  grant?: NearSetupGrantState | null;
};

async function postSetup(
  path: string,
  publicKey?: string | null,
): Promise<NearSetupState | null> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(
        publicKey ? { publicKey } : {},
      ),
    });
    const data = (await res.json().catch(() => null)) as
      | NearSetupState
      | { error?: string }
      | null;
    if (
      data &&
      typeof data === "object" &&
      typeof (data as NearSetupState).needsSetup === "boolean"
    ) {
      return data as NearSetupState;
    }
    return null;
  } catch {
    return null;
  }
}

/** Reads the current setup state for the signed-in NEAR wallet. */
export function fetchNearSetup(
  publicKey?: string | null,
): Promise<NearSetupState | null> {
  return postSetup("/api/near/setup", publicKey);
}

/** Sends the one-time network fee, or returns the existing grant. */
export function fundNearSetup(
  publicKey?: string | null,
): Promise<NearSetupState | null> {
  return postSetup("/api/near/setup/fund", publicKey);
}

/** Confirms that the wallet's registration transaction is on chain. */
export async function confirmNearSetup(
  publicKey?: string | null,
): Promise<{ ok: boolean; pending: boolean } | null> {
  try {
    const res = await fetch("/api/near/setup/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(publicKey ? { publicKey } : {}),
    });
    if (res.status === 409) return { ok: false, pending: true };
    if (!res.ok) return null;
    return { ok: true, pending: false };
  } catch {
    return null;
  }
}

const DISMISSED_PREFIX = "myntle:near-setup-dismissed:";

/** Whether this browser already showed the setup prompt for the account. */
export function wasNearSetupDismissed(address: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(`${DISMISSED_PREFIX}${address}`) === "1";
  } catch {
    return false;
  }
}

/** Keeps the prompt from reopening on every render after a dismissal. */
export function dismissNearSetup(address: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(`${DISMISSED_PREFIX}${address}`, "1");
  } catch {
    // Storage unavailable; the in-memory ref still covers this visit.
  }
}

export function clearNearSetupDismissed(address: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(`${DISMISSED_PREFIX}${address}`);
  } catch {
    // Nothing to clear.
  }
}
