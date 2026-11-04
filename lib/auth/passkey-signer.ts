"use client";

import bs58 from "bs58";
import {
  base64UrlDecode,
  base64UrlEncode,
  derToRawSignature,
  encodeP256PublicKey,
  payloadChallenge,
  payloadDigest,
  P256_PREFIX,
} from "@/lib/auth/passkeys";
import {
  friendlyPasskeyError,
  PasskeyError,
} from "@/lib/auth/passkey-client";

/**
 * The client half of a passkey-signed NEAR Intents payload.
 *
 * The server stores the exact string `generate-intent` returned and verifies
 * the assertion against it, so this module never parses and re-stringifies the
 * payload. The bytes signed are the bytes the server holds.
 *
 * The shape below is the six-field `signedData` W2b1 verifies
 * (`lib/intents/verify-intent.ts`):
 *
 * - `payload` — the exact payload string, untouched
 * - `client_data_json` — the raw decoded JSON string, not base64
 * - `authenticator_data` — base64url of the raw authenticator data
 * - `signature` — `p256:<base58(64-byte low-S r||s)>`, DER converted here
 * - `public_key` — `p256:<base58(64-byte x||y)>` from the session identity
 *
 * Nothing here logs, and no payload, challenge, or signature is ever printed.
 */

/** What the session identity supplies to sign. All public values. */
export type PasskeyIntentKey = {
  /** base64url credential id, as the session route reports it. */
  credentialId: string;
  /** `p256:<base58(x||y)>`, as the session route reports it. */
  publicKey: string;
  /** The WebAuthn relying party the credential belongs to. */
  rpId: string;
};

/** The exact six fields `/api/intents/submit` expects inside `signedData`. */
export type PasskeySignedIntent = {
  standard: "webauthn";
  payload: string;
  public_key: string;
  signature: string;
  client_data_json: string;
  authenticator_data: string;
};

const FAILED = "The passkey did not sign this trade. Nothing was moved.";
const CANCELLED = "The passkey prompt was cancelled. Nothing was moved.";
const UNAVAILABLE =
  "This browser cannot use a passkey. Nothing was moved.";

/** ArrayBuffer (browser) or a typed array (tests) as bytes, without copying. */
function bytesOf(value: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return new Uint8Array(value);
}

/**
 * An exact ArrayBuffer copy of the given bytes.
 *
 * `Uint8Array<ArrayBufferLike>` is not assignable to the DOM's `BufferSource`
 * because it may be backed by a `SharedArrayBuffer`. The ceremony options take
 * a plain ArrayBuffer, and copying also keeps the caller's bytes untouched.
 */
function bufferOf(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

/**
 * Cancellation is the one ceremony failure whose copy changes for a signature:
 * the wallet dialog's sentence is about the account, and this one is about the
 * trade. Every other case keeps the existing passkey wording.
 */
function signingErrorMessage(cause: unknown): string {
  if (cause instanceof PasskeyError) return cause.message;

  const error = cause instanceof Error ? cause : null;
  const code =
    error && typeof (error as { code?: unknown }).code === "string"
      ? ((error as { code?: string }).code ?? "")
      : "";
  if (
    error &&
    (error.name === "NotAllowedError" ||
      error.name === "AbortError" ||
      error.name === "TimeoutError" ||
      code === "ERROR_CEREMONY_ABORTED")
  ) {
    return CANCELLED;
  }
  return friendlyPasskeyError(cause);
}

/**
 * Signs one exact compose payload with the passkey that owns the account.
 *
 * The WebAuthn challenge is `SHA-256(payload)` as 32 raw bytes. The browser
 * base64url-encodes that inside `clientDataJSON`, and the server recomputes
 * the same digest from its stored string. A challenge mismatch is rejected
 * here as well, before the signature leaves the browser.
 */
export async function signIntentWithPasskey(
  payload: string,
  passkey: PasskeyIntentKey,
): Promise<PasskeySignedIntent> {
  if (!payload) throw new PasskeyError(FAILED);
  if (
    typeof navigator === "undefined" ||
    typeof navigator.credentials?.get !== "function"
  ) {
    throw new PasskeyError(UNAVAILABLE);
  }

  let publicKey: string;
  let credentialId: Uint8Array;
  try {
    publicKey = encodeP256PublicKey(passkey.publicKey);
    credentialId = base64UrlDecode(passkey.credentialId);
  } catch {
    throw new PasskeyError(FAILED);
  }
  if (!passkey.rpId) throw new PasskeyError(FAILED);

  const challenge = payloadDigest(payload);
  const expectedChallenge = payloadChallenge(payload);

  let credential: Credential | null;
  try {
    credential = await navigator.credentials.get({
      publicKey: {
        challenge: bufferOf(challenge),
        rpId: passkey.rpId,
        allowCredentials: [{ type: "public-key", id: bufferOf(credentialId) }],
        userVerification: "required",
        timeout: 60_000,
      },
    });
  } catch (cause) {
    throw new PasskeyError(signingErrorMessage(cause));
  }

  if (!credential) throw new PasskeyError(FAILED);

  // Duck-typed rather than `instanceof AuthenticatorAssertionResponse`: the
  // class is a browser global, and the shape is what matters here.
  const assertion = (credential as PublicKeyCredential)
    .response as Partial<AuthenticatorAssertionResponse>;
  if (
    !assertion ||
    assertion.clientDataJSON === undefined ||
    assertion.authenticatorData === undefined ||
    assertion.signature === undefined
  ) {
    throw new PasskeyError(FAILED);
  }

  let clientDataJSON: string;
  try {
    clientDataJSON = new TextDecoder("utf-8", { fatal: true }).decode(
      bytesOf(assertion.clientDataJSON),
    );
  } catch {
    throw new PasskeyError(FAILED);
  }

  let clientData: { type?: unknown; challenge?: unknown };
  try {
    clientData = JSON.parse(clientDataJSON) as {
      type?: unknown;
      challenge?: unknown;
    };
  } catch {
    throw new PasskeyError(FAILED);
  }

  // The assertion must cover this exact payload. A different challenge means
  // the authenticator signed something else, and nothing is submitted.
  if (
    clientData.type !== "webauthn.get" ||
    clientData.challenge !== expectedChallenge
  ) {
    throw new PasskeyError(FAILED);
  }

  let signature: string;
  try {
    // WebAuthn returns DER; the verifier wants 64 raw bytes and rejects
    // high-S. `derToRawSignature` normalizes at the one place both sides use.
    const raw = derToRawSignature(bytesOf(assertion.signature));
    signature = `${P256_PREFIX}${bs58.encode(raw)}`;
  } catch {
    throw new PasskeyError(FAILED);
  }

  return {
    standard: "webauthn",
    payload,
    public_key: publicKey,
    signature,
    client_data_json: clientDataJSON,
    authenticator_data: base64UrlEncode(bytesOf(assertion.authenticatorData)),
  };
}
