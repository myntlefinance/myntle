import bs58 from "bs58";
import { getIntentsSalt } from "./salt";
import { toHex } from "@/lib/wallet/types";

/**
 * The empty-intent ownership proof that mints a User-Session.
 *
 * `intents: []` moves nothing; it only proves the key holder matches
 * `signer_id`. Built at click time over a cached-or-fresh salt — never
 * earlier, because the nonce embeds the start time and the deadline is
 * five minutes out. EVM verified live against 1Click; Solana and NEAR
 * follow the documented shapes and await their own probe.
 */

const MAGIC = new Uint8Array([86, 40, 246, 198]);

function timestampedRandomBytes(now: Date): Uint8Array {
  const bytes = new Uint8Array(15);
  new DataView(bytes.buffer).setBigInt64(0, BigInt(now.getTime()) * 1_000_000n, true);
  crypto.getRandomValues(bytes.subarray(8));
  return bytes;
}

function encodeVersionedNonce(
  salt: Uint8Array,
  deadline: Date,
  randomBytes: Uint8Array,
): string {
  const borsh = new Uint8Array(27);
  borsh.set(salt, 0);
  new DataView(borsh.buffer).setBigUint64(4, BigInt(deadline.getTime()) * 1_000_000n, true);
  borsh.set(randomBytes, 12);
  const out = new Uint8Array(5 + borsh.length);
  out.set(MAGIC, 0);
  out.set([0], 4);
  out.set(borsh, 5);
  let bin = "";
  for (let i = 0; i < out.length; i += 1) bin += String.fromCharCode(out[i]);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export type EmptyIntentStandard =
  | "erc191"
  | "raw_ed25519"
  | "nep413"
  | "webauthn";

/** Every standard a connected wallet can sign. WebAuthn has its own builder. */
type WalletEmptyIntentStandard = Exclude<EmptyIntentStandard, "webauthn">;

export type BuiltEmptyIntent = {
  standard: WalletEmptyIntentStandard;
  /** The exact string the wallet signs (EVM/Solana). */
  payload?: string;
  /** NEP-413 envelope parts (NEAR). */
  nep413?: { recipient: string; nonceBase64: string; message: string };
  /** Raw nonce bytes for wallet calls that take bytes. */
  nonceBytes: Uint8Array;
  signerId: string;
  deadline: Date;
};

/**
 * The passkey ownership proof.
 *
 * P0.5 measured that a User-Session proof is addressed to `intents.near` with
 * the live public salt, even for a confidential account. That is the opposite
 * of a confidential swap payload, which `generate-intent` addresses to
 * `intents.far` with the confidential shard's salt.
 */
export type BuiltPasskeyEmptyIntent = {
  standard: Extract<EmptyIntentStandard, "webauthn">;
  /** The exact string the passkey signs. Never re-stringified. */
  payload: string;
  nonceBytes: Uint8Array;
  signerId: string;
  deadline: Date;
};

/** `signer_id` the verifier derives from each wallet key. */
export function signerIdFor(chain: string, address: string): string {
  const c = chain.toLowerCase();
  if (c === "evm") return address.toLowerCase();
  if (c === "near") return address;
  if (c === "solana") {
    return toHex(bs58.decode(address));
  }
  throw new Error("This wallet cannot unlock the super account yet.");
}

/** Builds the proof. Fetches the live salt (5-min cached) when needed. */
export async function buildEmptyIntent(
  chain: "evm" | "solana" | "near",
  address: string,
): Promise<BuiltEmptyIntent> {
  const { bytes: salt } = await getIntentsSalt();
  const now = new Date();
  const deadline = new Date(now.getTime() + 5 * 60_000);
  const randomBytes = timestampedRandomBytes(now);
  const nonceBase64 = encodeVersionedNonce(salt, deadline, randomBytes);
  const signerId = signerIdFor(chain, address);
  if (chain === "near") {
    return {
      standard: "nep413",
      nep413: {
        recipient: "intents.near",
        nonceBase64,
        message: JSON.stringify({
          deadline: deadline.toISOString(),
          intents: [],
          signer_id: signerId,
        }),
      },
      nonceBytes: base64ToBytes(nonceBase64),
      signerId,
      deadline,
    };
  }
  return {
    standard: chain === "evm" ? "erc191" : "raw_ed25519",
    payload: JSON.stringify({
      signer_id: signerId,
      verifying_contract: "intents.near",
      deadline: deadline.toISOString(),
      nonce: nonceBase64,
      intents: [],
    }),
    nonceBytes: base64ToBytes(nonceBase64),
    signerId,
    deadline,
  };
}

/**
 * The empty intent a passkey signs to mint a User-Session.
 *
 * The payload is addressed to the public `intents.near` verifier with the
 * live `current_salt`, not the confidential shard's salt. P0.5 rejected
 * `intents.far`, the confidential `e110f317` salt, and a random salt with the
 * same generic `signature verification failed`; only this pair was accepted.
 *
 * `intents: []` moves nothing. The nonce keeps the wallet builders'
 * timestamped 15-byte tail, because the auth endpoint rejects a start time
 * that is already ten minutes old.
 */
export async function buildPasskeyEmptyIntent(
  accountId: string,
): Promise<BuiltPasskeyEmptyIntent> {
  const { bytes: salt } = await getIntentsSalt();
  const now = new Date();
  const deadline = new Date(now.getTime() + 5 * 60_000);
  const randomBytes = timestampedRandomBytes(now);
  const nonceBase64 = encodeVersionedNonce(salt, deadline, randomBytes);
  return {
    standard: "webauthn",
    payload: JSON.stringify({
      signer_id: accountId,
      verifying_contract: "intents.near",
      deadline: deadline.toISOString(),
      nonce: nonceBase64,
      intents: [],
    }),
    nonceBytes: base64ToBytes(nonceBase64),
    signerId: accountId,
    deadline,
  };
}

/** Wallets return NEP-413 signatures as base64 or hex strings. */
function decodeWalletSignature(input: string): Uint8Array {
  const clean = input.startsWith("0x") ? input.slice(2) : input;
  if (/^[0-9a-fA-F]{128}$/.test(clean)) {
    const out = new Uint8Array(64);
    for (let i = 0; i < 64; i += 1) {
      out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
  }
  const bin = atob(input);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** Encodes a raw wallet signature into the verifier's MultiPayload form. */
export function encodeSignedData(
  built: BuiltEmptyIntent,
  signature: Uint8Array | string,
  publicKeyBase58?: string,
): Record<string, unknown> {
  const signatureBytes =
    typeof signature === "string" ? decodeWalletSignature(signature) : signature;
  if (built.standard === "erc191") {
    const sig = Uint8Array.from(signatureBytes);
    const v = sig[sig.length - 1];
    if (v === 27 || v === 28) sig[sig.length - 1] = v - 27;
    return {
      standard: "erc191",
      payload: built.payload,
      signature: `secp256k1:${bs58.encode(sig)}`,
    };
  }
  if (built.standard === "raw_ed25519") {
    return {
      standard: "raw_ed25519",
      payload: built.payload,
      public_key: publicKeyBase58,
      signature: `ed25519:${bs58.encode(signatureBytes)}`,
    };
  }
  // NEP-413 wallets hand back an already-prefixed public key and a
  // base64-or-hex signature; only the signature needs re-encoding.
  return {
    standard: "nep413",
    payload: {
      recipient: built.nep413?.recipient,
      nonce: built.nep413?.nonceBase64,
      message: built.nep413?.message,
    },
    public_key: publicKeyBase58,
    signature: `ed25519:${bs58.encode(signatureBytes)}`,
  };
}
