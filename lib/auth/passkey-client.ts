"use client";

import { useSyncExternalStore } from "react";
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/browser";

/**
 * The browser half of the passkey ceremonies.
 *
 * Registration is only called from the "Create account" action and login
 * from "Sign in"; both end at the B1b routes, which are the authority for
 * the account ID, the public key, and the session. Nothing here derives an
 * identity from the credential, and no assertion or signature is logged.
 */

export type PasskeyAccount = {
  accountId: string;
  credentialId: string;
  publicKey: string;
};

const GENERIC = "That passkey did not work. Try again or use a wallet.";
const CANCELLED =
  "The passkey prompt was cancelled. Your account was not changed.";
const DUPLICATE =
  "This passkey already has an account. Sign in instead.";
const OTHER_SITE =
  "This passkey belongs to a different site. Use the site where you created it.";
const TOO_MANY = "Too many attempts. Try again in a minute.";

/** An error whose message is already written for the person reading it. */
export class PasskeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PasskeyError";
  }
}

export function passkeyUiEnabled(): boolean {
  return process.env.NEXT_PUBLIC_PASSKEY_ENABLED === "true";
}

/**
 * Whether this browser can run a ceremony at all. The entry is hidden when
 * either the flag is off or the platform has no WebAuthn, so the interface
 * never offers a button that cannot work.
 */
export function passkeysAvailable(): boolean {
  if (!passkeyUiEnabled()) return false;
  return browserSupportsWebAuthn();
}

/**
 * The render-safe form of `passkeysAvailable`.
 *
 * The server and the first client render must agree, so this answers `false`
 * until hydration has looked at the actual browser. Pages that are rendered
 * before a click use this; a click handler can use the synchronous check.
 */
function subscribePasskeys(): () => void {
  return () => {};
}

export function usePasskeysAvailable(): boolean {
  return useSyncExternalStore(
    subscribePasskeys,
    passkeysAvailable,
    () => false,
  );
}

type CeremonyError = Error & { code?: string; name?: string };

function ceremonyError(cause: unknown): CeremonyError | null {
  return cause instanceof Error ? (cause as CeremonyError) : null;
}

/**
 * Turns the browser's ceremony errors into the few sentences a person can
 * act on. Detection is by name and code because the message text differs
 * between platforms.
 */
export function friendlyPasskeyError(cause: unknown): string {
  if (cause instanceof PasskeyError) return cause.message;

  const error = ceremonyError(cause);
  if (!error) return GENERIC;

  const name = error.name;
  const code = error.code ?? "";
  const message = error.message;

  if (
    code === "ERROR_INVALID_DOMAIN" ||
    code === "ERROR_INVALID_RP_ID" ||
    name === "SecurityError" ||
    /origin|rp id|relying party|different (site|domain)/i.test(message)
  ) {
    return OTHER_SITE;
  }

  if (
    name === "InvalidStateError" ||
    code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED" ||
    /already (registered|exists)|already has an account/i.test(message)
  ) {
    return DUPLICATE;
  }

  if (
    code === "ERROR_CEREMONY_ABORTED" ||
    name === "AbortError" ||
    name === "NotAllowedError" ||
    name === "TimeoutError" ||
    /reject|cancel|denied|dismiss|timed out/i.test(message)
  ) {
    return CANCELLED;
  }

  return GENERIC;
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    // A route that answers with no JSON still has a status to report.
  }

  if (!res.ok) {
    if (res.status === 429) throw new PasskeyError(TOO_MANY);
    if (res.status === 404 || res.status >= 500) {
      throw new PasskeyError(GENERIC);
    }
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? (payload as { error?: unknown }).error
        : null;
    throw new PasskeyError(
      typeof message === "string" && message.trim() ? message : GENERIC,
    );
  }

  return payload as T;
}

type RegistrationOptionsReply = {
  challengeId: string;
  options: PublicKeyCredentialCreationOptionsJSON;
};

type AuthenticationOptionsReply = {
  challengeId: string;
  options: PublicKeyCredentialRequestOptionsJSON;
};

type AccountReply = {
  ok: true;
  account: PasskeyAccount;
};

/** Creates the account and lands the session cookie. */
export async function createPasskey(
  displayName?: string,
): Promise<PasskeyAccount> {
  const start = await postJson<RegistrationOptionsReply>(
    "/api/auth/passkey/register/options",
  );

  let response: RegistrationResponseJSON;
  try {
    response = await startRegistration({ optionsJSON: start.options });
  } catch (cause) {
    throw new PasskeyError(friendlyPasskeyError(cause));
  }

  const done = await postJson<AccountReply>(
    "/api/auth/passkey/register/verify",
    {
      challengeId: start.challengeId,
      response,
      ...(displayName ? { label: displayName } : {}),
    },
  );
  return done.account;
}

/** Signs in with an existing passkey and lands the session cookie. */
export async function authenticatePasskey(): Promise<PasskeyAccount> {
  const start = await postJson<AuthenticationOptionsReply>(
    "/api/auth/passkey/login/options",
  );

  let response: AuthenticationResponseJSON;
  try {
    response = await startAuthentication({ optionsJSON: start.options });
  } catch (cause) {
    throw new PasskeyError(friendlyPasskeyError(cause));
  }

  const done = await postJson<AccountReply>(
    "/api/auth/passkey/login/verify",
    { challengeId: start.challengeId, response },
  );
  return done.account;
}
