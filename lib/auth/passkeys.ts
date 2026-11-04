/**
 * Passkey cryptography for a passkey-owned NEAR Intents account.
 *
 * These helpers pin the byte-level contract in
 * `plans/passkeys/02-crypto-and-standards.md`. The verifier is unforgiving:
 * a compressed key, a re-stringified payload, or a high-S signature all
 * produce the same generic "signature verification failed".
 *
 * Nothing here signs, submits, or touches the network. The server only ever
 * handles public keys and signatures; the private key stays in the
 * authenticator.
 *
 * `cbor-x` decodes the COSE key SimpleWebAuthn returns at registration. Its
 * optional native accelerator is disabled in deployment with
 * `CBOR_NATIVE_ACCELERATION_DISABLED=true`.
 */

import { p256 } from "@noble/curves/p256";
import bs58 from "bs58";
import { decode as decodeCbor } from "cbor-x";
import {
  concat,
  hexToBytes,
  keccak256,
  sha256,
  stringToBytes,
} from "viem";

/** Public keys and signatures both travel with this prefix. */
export const P256_PREFIX = "p256:";

const PUBLIC_KEY_BYTES = 64;
const SIGNATURE_BYTES = 64;
const COORDINATE_BYTES = 32;

/* ------------------------------------------------------------------ */
/* base64                                                              */
/* ------------------------------------------------------------------ */

/** Unpadded base64url. This is what `clientDataJSON.challenge` holds. */
export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Accepts base64url (the browser's form) or standard base64 with or without
 * padding (the verifier's fixtures and a database column may use either).
 */
export function base64UrlDecode(value: string): Uint8Array {
  const clean = value.replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
  const padded = clean + "=".repeat((4 - (clean.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new Error("The passkey data is not valid base64.");
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/* ------------------------------------------------------------------ */
/* the account derivation                                              */
/* ------------------------------------------------------------------ */

function assertPublicKeyBytes(bytes: Uint8Array): void {
  // Length only. The account is derived from the bytes before any signature
  // is checked, and the verifier's published derivation vector is not itself
  // a curve point. Point validity belongs to verification, not encoding.
  if (bytes.length === PUBLIC_KEY_BYTES) return;
  if (bytes.length === 33) {
    throw new Error(
      "A compressed P256 public key is not supported; pass the 64-byte x||y key.",
    );
  }
  if (bytes.length === 65 && bytes[0] === 0x04) {
    throw new Error(
      "An uncompressed SEC1 P256 public key with the 0x04 prefix is not supported; pass the 64-byte x||y key.",
    );
  }
  throw new Error(
    `A P256 public key must be 64 bytes (x||y), got ${bytes.length}.`,
  );
}

/**
 * Decodes `p256:<base58>` or bare base58 into the 64-byte `x || y` the
 * verifier expects. The `0x04` SEC1 prefix is rejected rather than stripped:
 * a caller that passes the wrong encoding should fix it at the source.
 */
export function decodeP256PublicKey(value: string): Uint8Array {
  const encoded = value.startsWith(P256_PREFIX)
    ? value.slice(P256_PREFIX.length)
    : value;
  let bytes: Uint8Array;
  try {
    bytes = bs58.decode(encoded);
  } catch {
    throw new Error("The passkey public key is not valid base58.");
  }
  assertPublicKeyBytes(bytes);
  return bytes;
}

export function encodeP256PublicKey(publicKey: Uint8Array | string): string {
  const bytes =
    typeof publicKey === "string" ? decodeP256PublicKey(publicKey) : publicKey;
  assertPublicKeyBytes(bytes);
  return `${P256_PREFIX}${bs58.encode(bytes)}`;
}

/**
 * Standard base64 for the `passkey_accounts.p256_public_key` column.
 *
 * The wire format is `p256:<base58>`; the database stores the same 64 bytes
 * as base64 so the column is a plain byte encoding with no prefix. Keep the
 * conversion at the storage boundary.
 */
export function encodeP256PublicKeyBase64(
  publicKey: Uint8Array | string,
): string {
  const bytes =
    typeof publicKey === "string" ? decodeP256PublicKey(publicKey) : publicKey;
  assertPublicKeyBytes(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Reads the base64 `passkey_accounts.p256_public_key` column. */
export function decodeP256PublicKeyBase64(value: string): Uint8Array {
  const bytes = base64UrlDecode(value);
  assertPublicKeyBytes(bytes);
  return bytes;
}

/**
 * `0x` + hex(keccak256("p256" || x || y)[12..32]).
 *
 * This is deliberately not the EVM derivation. The `"p256"` tag is what
 * keeps a passkey account from colliding with a secp256k1 address.
 */
export function intentsAccountIdForPasskey(
  publicKey64: Uint8Array | string,
): `0x${string}` {
  const bytes =
    typeof publicKey64 === "string"
      ? decodeP256PublicKey(publicKey64)
      : publicKey64;
  assertPublicKeyBytes(bytes);
  const digest = keccak256(concat([stringToBytes("p256"), bytes]));
  return `0x${digest.slice(2 + 24)}` as `0x${string}`;
}

/* ------------------------------------------------------------------ */
/* the WebAuthn challenge                                              */
/* ------------------------------------------------------------------ */

/** SHA-256 of the exact payload bytes, as 32 bytes. */
export function payloadDigest(payload: string): Uint8Array {
  return hexToBytes(sha256(stringToBytes(payload)));
}

/** base64url(SHA-256(payload)) — the value inside `clientDataJSON.challenge`. */
export function payloadChallenge(payload: string): string {
  return base64UrlEncode(payloadDigest(payload));
}

/**
 * The exact bytes an ES256 WebAuthn assertion signs:
 * `authenticatorData || SHA-256(clientDataJSON)`.
 *
 * This is not SHA-256(payload). The challenge inside `clientDataJSON` already
 * binds the payload; the signature binds the authenticator data and the hash
 * of that client data.
 */
export function webAuthnSignedMessage(args: {
  authenticatorData: Uint8Array;
  clientDataJSON: string;
}): Uint8Array {
  return concat([
    args.authenticatorData,
    hexToBytes(sha256(stringToBytes(args.clientDataJSON))),
  ]);
}

/* ------------------------------------------------------------------ */
/* the signature encoding                                              */
/* ------------------------------------------------------------------ */

/** DER (what WebAuthn returns) → 64-byte raw `r || s`, normalized low-S. */
export function derToRawSignature(der: Uint8Array): Uint8Array {
  if (der.length === 0) {
    throw new Error("The passkey signature is empty.");
  }

  let parsed: InstanceType<typeof p256.Signature>;
  try {
    parsed = p256.Signature.fromBytes(der, "der");
  } catch {
    throw new Error("The passkey signature is not valid DER.");
  }

  // @noble/curves signs high-S roughly half the time. The Intents verifier
  // rejects high-S, so normalize rather than reject a valid assertion.
  const lowS = parsed.hasHighS()
    ? new p256.Signature(parsed.r, p256.CURVE.n - parsed.s)
    : parsed;

  const raw = lowS.toBytes("compact");
  if (raw.length !== SIGNATURE_BYTES) {
    throw new Error(
      `A P256 signature must be 64 bytes (r||s), got ${raw.length}.`,
    );
  }
  return raw;
}

function decodeP256Signature(value: string): Uint8Array {
  const encoded = value.startsWith(P256_PREFIX)
    ? value.slice(P256_PREFIX.length)
    : value;
  let bytes: Uint8Array;
  try {
    bytes = bs58.decode(encoded);
  } catch {
    throw new Error("The passkey signature is not valid base58.");
  }
  if (bytes.length !== SIGNATURE_BYTES) {
    throw new Error(
      `A P256 signature must be 64 bytes (r||s), got ${bytes.length}.`,
    );
  }
  return bytes;
}

/**
 * Verifies an ES256 signature over a message, hashing the message with
 * SHA-256 first. For a WebAuthn assertion, pass `webAuthnSignedMessage(...)`,
 * not SHA-256(payload).
 *
 * Returns false for a malformed key, a malformed signature, a high-S
 * signature, or an invalid point. The Intents verifier rejects all four, so
 * the server must not forward them.
 *
 * A valid signature is not a complete assertion check. The caller still has
 * to compare the clientDataJSON challenge and origin, the authenticator
 * rpIdHash, and the UP/UV flags.
 */
export function verifyP256Signature(args: {
  publicKey: Uint8Array | string;
  signature: Uint8Array | string;
  message: Uint8Array;
}): boolean {
  try {
    const publicKey =
      typeof args.publicKey === "string"
        ? decodeP256PublicKey(args.publicKey)
        : args.publicKey;
    assertPublicKeyBytes(publicKey);

    const signature =
      typeof args.signature === "string"
        ? decodeP256Signature(args.signature)
        : args.signature;
    if (signature.length !== SIGNATURE_BYTES) return false;

    const parsed = p256.Signature.fromBytes(signature, "compact");
    if (parsed.hasHighS()) return false;

    const digest = hexToBytes(sha256(args.message));
    return p256.verify(
      parsed.toBytes("compact"),
      digest,
      concat([new Uint8Array([0x04]), publicKey]),
    );
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* the COSE public key                                                 */
/* ------------------------------------------------------------------ */

/**
 * Extracts `x || y` from the COSE key `verifyRegistrationResponse` returns.
 *
 * ES256/P-256 only: kty=2 (EC2), alg=-7 (ES256), crv=1 (P-256). A credential
 * with any other algorithm is rejected at registration rather than stored in
 * a shape the verifier cannot use.
 */
export function parseCoseP256PublicKey(cose: Uint8Array | string): Uint8Array {
  const bytes = typeof cose === "string" ? base64UrlDecode(cose) : cose;

  let decoded: unknown;
  try {
    decoded = decodeCbor(bytes);
  } catch {
    throw new Error("The passkey public key is not a COSE key.");
  }

  const get = (key: number): unknown => {
    if (decoded instanceof Map) {
      return decoded.get(key) ?? decoded.get(String(key));
    }
    if (decoded && typeof decoded === "object") {
      return (decoded as Record<string, unknown>)[String(key)];
    }
    return undefined;
  };

  if (get(1) !== 2) throw new Error("Only EC2 COSE keys are supported.");
  if (get(3) !== -7) throw new Error("Only ES256 COSE keys are supported.");
  if (get(-1) !== 1) throw new Error("Only P-256 COSE keys are supported.");

  const x = get(-2);
  const y = get(-3);
  if (!(x instanceof Uint8Array) || x.length !== COORDINATE_BYTES) {
    throw new Error("The COSE key is missing a 32-byte x coordinate.");
  }
  if (!(y instanceof Uint8Array) || y.length !== COORDINATE_BYTES) {
    throw new Error("The COSE key is missing a 32-byte y coordinate.");
  }

  const publicKey = new Uint8Array(PUBLIC_KEY_BYTES);
  publicKey.set(x, 0);
  publicKey.set(y, COORDINATE_BYTES);
  return publicKey;
}
