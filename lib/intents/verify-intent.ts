/**
 * Server-side verification of a signed NEAR Intents payload.
 *
 * P0.4 measured that 1Click's `submit-intent` enqueues rather than verifies:
 * a real assertion and a forged one both return `201 { intentHash }`. This
 * module is the server's own gate, and it runs before anything is submitted.
 *
 * The checks here mirror what the verifier ignores but the product cannot:
 * the WebAuthn challenge, the origin, `UP`, `UV`, the RP ID hash, the stored
 * public key, and the exact payload string. The payload's semantics are then
 * compared to the quote the server itself stored, so the signed `transfer`
 * can only fund the quote it was generated for.
 *
 * It is pure: no Supabase, no direct `fetch`, no `after()`, and no logging.
 * The one network read lives inside `verifyWalletSignature` for NEP-413,
 * which resolves the account's access key on RPC; that helper is unchanged.
 * The passkey and EVM/Solana paths never touch the network.
 *
 * `intentHash = base58(sha256(payload))`. P0.4 proved it is content addressed
 * and computable offline, so it is a useful dedupe key and never a verdict.
 * An `ok: true` here means the server verified the assertion; settlement is
 * still read from `GET /v0/status?depositAddress=…` by the workflow.
 */

import { p256 } from "@noble/curves/p256";
import bs58 from "bs58";
import { bytesToHex, hexToBytes, sha256, stringToBytes } from "viem";
import {
  base64UrlDecode,
  decodeP256PublicKey,
  payloadChallenge,
  P256_PREFIX,
  verifyP256Signature,
  webAuthnSignedMessage,
} from "@/lib/auth/passkeys";
import type { AuthChain } from "@/lib/auth/challenge";
import { verifyWalletSignature } from "@/lib/auth/signatures";
import type { IntentStandard } from "./service";

/**
 * Which verifier contract the payload was generated for.
 *
 * P0.3 measured that a `CONFIDENTIAL_INTENTS` swap is addressed to
 * `intents.far`, the confidential contract on a private NEAR shard. The
 * User-Session ownership proof (P0.5) and any public-shard payload use
 * `intents.near`. The two are never interchangeable.
 *
 * `confidential` maps from the `confidential-intents` quote mode. The
 * `chain` mode has no signed payload at all, and `confidential-external`
 * funds a balance from an external chain, so neither reaches this verifier.
 */
export type IntentVerificationMode = "confidential" | "public";

const CONTRACT_BY_MODE: Record<IntentVerificationMode, string> = {
  confidential: "intents.far",
  public: "intents.near",
};

/** A wallet standard is fixed by the chain that signs it. */
const WALLET_STANDARD_BY_CHAIN: Record<AuthChain, IntentStandard> = {
  evm: "erc191",
  solana: "raw_ed25519",
  near: "nep413",
};

const KNOWN_STANDARDS: readonly IntentStandard[] = [
  "webauthn",
  "erc191",
  "raw_ed25519",
  "nep413",
];

/** WebAuthn flags. `BS` without `BE` is malformed per the spec. */
const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_BE = 0x08;
const FLAG_BS = 0x10;

const AUTHENTICATOR_DATA_MIN_BYTES = 37;
const SHA256_BYTES = 32;

/**
 * Stable rejection codes. The submit route maps these to one generic
 * response and never forwards the code to the browser, so a caller cannot
 * use the server as an oracle.
 */
export type IntentVerificationReason =
  | "signed-data-malformed"
  | "standard-unknown"
  | "standard-mismatch"
  | "standard-chain-mismatch"
  | "account-kind-mismatch"
  | "wallet-address-missing"
  | "payload-malformed"
  | "payload-mismatch"
  | "envelope-mismatch"
  | "signer-mismatch"
  | "contract-mismatch"
  | "deadline-mismatch"
  | "deadline-expired"
  | "intent-shape-mismatch"
  | "deposit-mismatch"
  | "token-mismatch"
  | "amount-mismatch"
  | "client-data-malformed"
  | "client-data-type"
  | "challenge-mismatch"
  | "origin-mismatch"
  | "cross-origin"
  | "authenticator-data-malformed"
  | "rp-id-mismatch"
  | "user-presence-required"
  | "user-verification-required"
  | "backup-flags-invalid"
  | "signature-malformed"
  | "signature-high-s"
  | "signature-invalid"
  | "public-key-malformed"
  | "public-key-mismatch"
  | "passkey-key-missing";

export type IntentVerificationResult =
  | {
      ok: true;
      standard: IntentStandard;
      /** `base58(sha256(payload))`; present on the WebAuthn path only. */
      intentHash?: string;
    }
  | { ok: false; reason: IntentVerificationReason };

export type VerifyIntentInput = {
  /** The `signedData` object the client sent. Untrusted. */
  signedData: unknown;
  /** Exactly what the server stored from `generate-intent`. */
  payload: string | Record<string, unknown>;
  /** The session's Intents account id. */
  signerId: string;
  /** The standard the server generated the payload for. */
  standard: IntentStandard;
  mode: IntentVerificationMode;
  /** The wet quote's deposit address. */
  depositAddress: string;
  /** The quote's amount in the smallest unit, as a decimal string. */
  amountIn: string;
  /**
   * The quote's origin asset id (`nep141:…`). The payload names the token as
   * `imt:<pool>:<assetId>`, so the check accepts either the bare asset id or
   * the same value after a colon.
   */
  assetId?: string;
  /** The quote deadline, ISO 8601. The payload must name the same instant. */
  deadline: string;
  accountKind: "passkey" | "wallet";
  chain: AuthChain;
  /** The connected wallet address; required for the wallet standards. */
  address?: string;
  /** `passkey_accounts.p256_public_key`, as `p256:<base58>`. */
  passkeyPublicKey?: string;
  webauthn: { rpID: string; origins: readonly string[] };
  /** Test seam. Defaults to `Date.now()`. */
  now?: number;
};

type Failure = { ok: false; reason: IntentVerificationReason };

function fail(reason: IntentVerificationReason): Failure {
  return { ok: false, reason };
}

/** `base58(sha256(payload))`, the 1Click `intentHash`. A dedupe key only. */
export function intentHashForPayload(payload: string): string {
  return bs58.encode(hexToBytes(sha256(stringToBytes(payload))));
}

/**
 * Verifies one signed intent against the payload and quote the server stored.
 *
 * Returns a typed result rather than throwing, so the route can map every
 * failure to one response without leaking which check failed.
 */
export async function verifyIntent(
  input: VerifyIntentInput,
): Promise<IntentVerificationResult> {
  const data = asRecord(input.signedData);
  if (!data) return fail("signed-data-malformed");

  const standard = data.standard;
  if (!isIntentStandard(standard)) return fail("standard-unknown");

  // The route pins the standard from the session; the client cannot swap it.
  if (standard !== input.standard) return fail("standard-mismatch");

  const compatibility = checkSignerCompatibility(input, standard);
  if (compatibility) return compatibility;

  if (standard === "webauthn") return verifyWebAuthnIntent(input, data);
  return verifyWalletIntent(input, data, standard);
}

/* ------------------------------------------------------------------ */
/* signer / chain compatibility                                        */
/* ------------------------------------------------------------------ */

function checkSignerCompatibility(
  input: VerifyIntentInput,
  standard: IntentStandard,
): Failure | null {
  if (input.accountKind === "passkey") {
    // A passkey account is a P-256 account. A wallet standard would mean the
    // route picked the wrong signer, and no chain lookup can rescue it.
    if (standard !== "webauthn" || input.standard !== "webauthn") {
      return fail("account-kind-mismatch");
    }
    return null;
  }

  if (standard === "webauthn" || input.standard === "webauthn") {
    return fail("account-kind-mismatch");
  }

  const expected = WALLET_STANDARD_BY_CHAIN[input.chain];
  if (!expected) return fail("standard-chain-mismatch");
  if (standard !== expected || input.standard !== expected) {
    return fail("standard-chain-mismatch");
  }
  if (!input.address) return fail("wallet-address-missing");
  return null;
}

/* ------------------------------------------------------------------ */
/* the WebAuthn path                                                   */
/* ------------------------------------------------------------------ */

function verifyWebAuthnIntent(
  input: VerifyIntentInput,
  data: Record<string, unknown>,
): IntentVerificationResult {
  if (typeof input.payload !== "string") return fail("payload-malformed");

  // P0.3: `generate-intent` mints a fresh nonce on every call, so a
  // regenerated payload never matches. The stored string is the only truth,
  // and it is compared byte for byte before any JSON is parsed.
  if (typeof data.payload !== "string" || data.payload !== input.payload) {
    return fail("payload-mismatch");
  }

  const payload = parseJsonRecord(input.payload);
  if (!payload) return fail("payload-malformed");

  if (payload.signer_id !== input.signerId) return fail("signer-mismatch");

  const expectedContract = CONTRACT_BY_MODE[input.mode];
  if (!expectedContract || payload.verifying_contract !== expectedContract) {
    return fail("contract-mismatch");
  }

  const payloadDeadline = parseDeadline(payload.deadline);
  const expectedDeadline = Date.parse(input.deadline);
  if (
    payloadDeadline === null ||
    !Number.isFinite(expectedDeadline) ||
    payloadDeadline !== expectedDeadline
  ) {
    return fail("deadline-mismatch");
  }
  if (payloadDeadline <= (input.now ?? Date.now())) {
    return fail("deadline-expired");
  }

  const intentFailure = checkTransferIntent(payload.intents, input);
  if (intentFailure) return intentFailure;

  const clientDataJSON = data.client_data_json;
  if (typeof clientDataJSON !== "string") return fail("client-data-malformed");
  const clientData = parseJsonRecord(clientDataJSON);
  if (!clientData) return fail("client-data-malformed");

  if (clientData.type !== "webauthn.get") return fail("client-data-type");
  if (clientData.challenge !== payloadChallenge(input.payload)) {
    return fail("challenge-mismatch");
  }
  if (
    typeof clientData.origin !== "string" ||
    !input.webauthn.origins.includes(clientData.origin)
  ) {
    return fail("origin-mismatch");
  }
  if (clientData.crossOrigin === true) return fail("cross-origin");

  const authenticatorData = decodeAuthenticatorData(data.authenticator_data);
  if (!authenticatorData) return fail("authenticator-data-malformed");
  if (authenticatorData.length < AUTHENTICATOR_DATA_MIN_BYTES) {
    return fail("authenticator-data-malformed");
  }

  // `sha256` already returns 0x-hex, so it is compared to `bytesToHex`, not
  // hex-encoded a second time.
  const rpIdHash = sha256(stringToBytes(input.webauthn.rpID));
  if (bytesToHex(authenticatorData.subarray(0, SHA256_BYTES)) !== rpIdHash) {
    return fail("rp-id-mismatch");
  }

  const flags = authenticatorData[32];
  if ((flags & FLAG_UP) === 0) return fail("user-presence-required");
  if ((flags & FLAG_UV) === 0) return fail("user-verification-required");
  const backupEligible = (flags & FLAG_BE) !== 0;
  const backupState = (flags & FLAG_BS) !== 0;
  if (backupState && !backupEligible) return fail("backup-flags-invalid");

  const signature = decodeCompactP256Signature(data.signature);
  if (!signature) return fail("signature-malformed");
  if (signature.highS) return fail("signature-high-s");

  if (!input.passkeyPublicKey) return fail("passkey-key-missing");
  let storedKey: Uint8Array;
  try {
    storedKey = decodeP256PublicKey(input.passkeyPublicKey);
  } catch {
    return fail("public-key-malformed");
  }

  const submittedKey = decodePublicKey(data.public_key);
  if (!submittedKey) return fail("public-key-malformed");
  if (bytesToHex(submittedKey) !== bytesToHex(storedKey)) {
    return fail("public-key-mismatch");
  }

  // P0.1: the assertion signs `authenticatorData || SHA-256(clientDataJSON)`,
  // not SHA-256(payload). The payload digest appears only in the challenge.
  const signedMessage = webAuthnSignedMessage({
    authenticatorData,
    clientDataJSON,
  });
  if (
    !verifyP256Signature({
      publicKey: storedKey,
      signature: signature.bytes,
      message: signedMessage,
    })
  ) {
    return fail("signature-invalid");
  }

  return {
    ok: true,
    standard: "webauthn",
    intentHash: intentHashForPayload(input.payload),
  };
}

/**
 * The confidential swap payload is one `transfer` of the origin amount to the
 * quote's deposit address. There is no `token_diff` and no `minAmountOut`:
 * the minimum output lives in the quote and is enforced by the solver.
 */
function checkTransferIntent(
  intents: unknown,
  input: VerifyIntentInput,
): Failure | null {
  if (!Array.isArray(intents) || intents.length !== 1) {
    return fail("intent-shape-mismatch");
  }
  const intent = asRecord(intents[0]);
  if (!intent) return fail("intent-shape-mismatch");
  if (intent.intent !== "transfer") return fail("intent-shape-mismatch");
  if (intent.receiver_id !== input.depositAddress) {
    return fail("deposit-mismatch");
  }

  const tokens = asRecord(intent.tokens);
  if (!tokens) return fail("token-mismatch");
  const tokenIds = Object.keys(tokens);
  if (tokenIds.length !== 1) return fail("token-mismatch");

  const tokenId = tokenIds[0];
  if (
    input.assetId &&
    tokenId !== input.assetId &&
    !tokenId.endsWith(`:${input.assetId}`)
  ) {
    return fail("token-mismatch");
  }

  const amount = tokens[tokenId];
  if (typeof amount !== "string" || !/^\d+$/.test(amount)) {
    return fail("amount-mismatch");
  }
  if (!/^\d+$/.test(input.amountIn)) return fail("amount-mismatch");
  if (BigInt(amount) !== BigInt(input.amountIn)) return fail("amount-mismatch");

  return null;
}

/* ------------------------------------------------------------------ */
/* the wallet paths                                                    */
/* ------------------------------------------------------------------ */

async function verifyWalletIntent(
  input: VerifyIntentInput,
  data: Record<string, unknown>,
  standard: IntentStandard,
): Promise<IntentVerificationResult> {
  const address = input.address;
  if (!address) return fail("wallet-address-missing");

  if (standard === "nep413") {
    return verifyNep413Intent(input, data, address);
  }

  if (typeof input.payload !== "string") return fail("payload-malformed");
  if (typeof data.payload !== "string" || data.payload !== input.payload) {
    return fail("payload-mismatch");
  }

  const signature = typeof data.signature === "string" ? data.signature : null;
  if (!signature) return fail("signature-malformed");

  try {
    if (standard === "erc191") {
      const signatureHex = decodeSecp256k1Signature(signature);
      if (!signatureHex) return fail("signature-malformed");
      await verifyWalletSignature({
        chain: "evm",
        address,
        message: input.payload,
        signature: signatureHex,
      });
    } else {
      const signatureHex = decodeEd25519Signature(signature);
      if (!signatureHex) return fail("signature-malformed");

      let publicKey: string | undefined;
      if (data.public_key !== undefined) {
        const decoded = decodeEd25519PublicKey(data.public_key);
        if (!decoded) return fail("public-key-malformed");
        publicKey = decoded;
      }

      await verifyWalletSignature({
        chain: "solana",
        address,
        message: input.payload,
        signature: signatureHex,
        publicKey,
      });
    }
  } catch {
    return fail("signature-invalid");
  }

  return { ok: true, standard };
}

/**
 * NEP-413 wraps the intent in `{ message, nonce, recipient }` (P0.3c).
 *
 * The signed `message` is the intent JSON, the `recipient` is the verifier
 * contract the key is registered for, and the `nonce` is a 32-byte versioned
 * nonce. All three are compared to the stored envelope exactly before the
 * signature is checked.
 */
async function verifyNep413Intent(
  input: VerifyIntentInput,
  data: Record<string, unknown>,
  address: string,
): Promise<IntentVerificationResult> {
  const stored = asRecord(input.payload);
  if (!stored) return fail("payload-malformed");
  const submitted = asRecord(data.payload);
  if (!submitted) return fail("payload-malformed");

  const message = stored.message;
  const recipient = stored.recipient;
  const nonce = stored.nonce;
  if (
    typeof message !== "string" ||
    typeof recipient !== "string" ||
    typeof nonce !== "string" ||
    submitted.message !== message ||
    submitted.recipient !== recipient ||
    submitted.nonce !== nonce
  ) {
    return fail("envelope-mismatch");
  }

  const signature = typeof data.signature === "string" ? data.signature : null;
  if (!signature) return fail("signature-malformed");
  const signatureHex = decodeEd25519Signature(signature);
  if (!signatureHex) return fail("signature-malformed");

  const publicKey = data.public_key;
  if (
    typeof publicKey !== "string" ||
    !/^(ed25519|secp256k1):[1-9A-HJ-NP-Za-km-z]+$/.test(publicKey)
  ) {
    return fail("public-key-malformed");
  }

  const nonceHex = decodeNep413Nonce(nonce);
  if (!nonceHex) return fail("payload-malformed");

  try {
    await verifyWalletSignature({
      chain: "near",
      address,
      message,
      signature: signatureHex,
      publicKey,
      recipient,
      nonce: nonceHex,
    });
  } catch {
    return fail("signature-invalid");
  }

  return { ok: true, standard: "nep413" };
}

/* ------------------------------------------------------------------ */
/* decoding helpers                                                    */
/* ------------------------------------------------------------------ */

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseJsonRecord(raw: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

function isIntentStandard(value: unknown): value is IntentStandard {
  return (
    typeof value === "string" &&
    (KNOWN_STANDARDS as readonly string[]).includes(value)
  );
}

/**
 * A payload deadline is either an ISO string or `{ timestamp: <seconds> }`;
 * the verifier accepts both (P0.1). Returns milliseconds, or null.
 */
function parseDeadline(value: unknown): number | null {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const record = asRecord(value);
  const timestamp = record?.timestamp;
  if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
    return timestamp * 1000;
  }
  return null;
}

function decodeAuthenticatorData(value: unknown): Uint8Array | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    return base64UrlDecode(value);
  } catch {
    return null;
  }
}

function decodePublicKey(value: unknown): Uint8Array | null {
  if (typeof value !== "string") return null;
  try {
    return decodeP256PublicKey(value);
  } catch {
    return null;
  }
}

function decodeCompactP256Signature(
  value: unknown,
): { bytes: Uint8Array; highS: boolean } | null {
  if (typeof value !== "string") return null;
  const encoded = value.startsWith(P256_PREFIX)
    ? value.slice(P256_PREFIX.length)
    : value;
  if (!encoded) return null;

  let bytes: Uint8Array;
  try {
    bytes = bs58.decode(encoded);
  } catch {
    return null;
  }
  if (bytes.length !== 64) return null;

  try {
    const signature = p256.Signature.fromBytes(bytes, "compact");
    return { bytes, highS: signature.hasHighS() };
  } catch {
    return null;
  }
}

/** Decodes `secp256k1:<base58>` or a 65-byte hex signature to normalized hex. */
function decodeSecp256k1Signature(value: string): `0x${string}` | null {
  let bytes: Uint8Array | null = null;

  if (value.startsWith("0x")) {
    if (/^0x[0-9a-fA-F]{130}$/.test(value)) bytes = hexToBytesStrict(value);
  } else if (value.startsWith("secp256k1:")) {
    bytes = decodeBase58(value.slice("secp256k1:".length));
  } else if (/^[0-9a-fA-F]{130}$/.test(value)) {
    bytes = hexToBytes(`0x${value}`);
  } else {
    bytes = decodeBase58(value);
  }

  if (!bytes || bytes.length !== 65) return null;

  const normalized = Uint8Array.from(bytes);
  const v = normalized[64];
  if (v === 27 || v === 28) {
    normalized[64] = v - 27;
  } else if (v !== 0 && v !== 1) {
    // EIP-155 chain-encoded `v` is not a personal-sign signature.
    return null;
  }
  return bytesToHex(normalized) as `0x${string}`;
}

/** Decodes `ed25519:<base58>` or 64-byte hex to 0x-prefixed hex. */
function decodeEd25519Signature(value: string): string | null {
  let bytes: Uint8Array | null = null;

  if (value.startsWith("ed25519:")) {
    bytes = decodeBase58(value.slice("ed25519:".length));
  } else if (value.startsWith("0x")) {
    if (/^0x[0-9a-fA-F]{128}$/.test(value)) bytes = hexToBytesStrict(value);
  } else if (/^[0-9a-fA-F]{128}$/.test(value)) {
    bytes = hexToBytes(`0x${value}`);
  } else {
    bytes = decodeBase58(value);
  }

  return bytes && bytes.length === 64 ? bytesToHex(bytes) : null;
}

/** Decodes `ed25519:<base58>`, bare base58, or 32-byte hex to 0x hex. */
function decodeEd25519PublicKey(value: unknown): string | null {
  if (typeof value !== "string") return null;

  let bytes: Uint8Array | null = null;
  if (value.startsWith("ed25519:")) {
    bytes = decodeBase58(value.slice("ed25519:".length));
  } else if (value.startsWith("0x")) {
    if (/^0x[0-9a-fA-F]{64}$/.test(value)) bytes = hexToBytesStrict(value);
  } else if (/^[0-9a-fA-F]{64}$/.test(value)) {
    bytes = hexToBytes(`0x${value}`);
  } else {
    bytes = decodeBase58(value);
  }

  return bytes && bytes.length === SHA256_BYTES ? bytesToHex(bytes) : null;
}

/** NEP-413 nonces travel as standard base64; the verifier helper wants hex. */
function decodeNep413Nonce(value: string): string | null {
  const raw = value.startsWith("0x") ? value.slice(2) : value;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return `0x${raw.toLowerCase()}`;

  try {
    const bytes = base64UrlDecode(value);
    return bytes.length === SHA256_BYTES ? bytesToHex(bytes) : null;
  } catch {
    return null;
  }
}

function decodeBase58(value: string): Uint8Array | null {
  try {
    return bs58.decode(value);
  } catch {
    return null;
  }
}

/** `hexToBytes` wants the `0x` literal type; the caller already matched it. */
function hexToBytesStrict(value: string): Uint8Array {
  return hexToBytes(value as `0x${string}`);
}
