/**
 * The wallet half of a signed NEAR Intents payload.
 *
 * A passkey account signs with WebAuthn; a wallet account signs the same
 * stored payload with the standard its chain uses. The payload is passed
 * through byte for byte — the server compares the exact bytes it stored, so
 * this module never parses and re-stringifies a string payload.
 *
 * P0.3c measured the shapes:
 *
 * - `erc191` and `raw_ed25519` return a JSON string, signed as UTF-8 bytes.
 * - `nep413` returns `{ message, nonce, recipient }`; the wallet signs the
 *   `message` under the verifier contract as the NEP-413 recipient, using the
 *   exact nonce the server stored.
 *
 * Nothing here logs, and no payload or signature is ever printed.
 */

import { hexToBytes } from "viem";
import { base64UrlDecode } from "@/lib/auth/passkeys";
import { toHex } from "@/lib/wallet/types";
import type { IntentStandard } from "./service";

/** The two signer calls the wallet adapter already exposes. */
export type WalletIntentSigner = {
  signMessage: (payload: Uint8Array) => Promise<Uint8Array>;
  signNEP413: (input: {
    message: string;
    recipient: string;
    nonce: Uint8Array;
  }) => Promise<{ signature: string; publicKey: string }>;
};

export type WalletSignedIntent =
  | { standard: "erc191"; payload: string; signature: string }
  | { standard: "raw_ed25519"; payload: string; signature: string }
  | {
      standard: "nep413";
      payload: Record<string, unknown>;
      signature: string;
      public_key: string;
    };

const FAILED = "The wallet did not sign this transfer. Nothing was moved.";

/** Decodes a NEP-413 nonce the way the server verifier reads it. */
export function decodeNep413Nonce(value: string): Uint8Array | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const raw = value.startsWith("0x") ? value.slice(2) : value;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return hexToBytes(`0x${raw.toLowerCase()}`);
  }
  try {
    const bytes = base64UrlDecode(value);
    return bytes.length === 32 ? bytes : null;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Signs one exact payload with the connected wallet.
 *
 * The standard was chosen by the server from the session, never by the
 * browser, and the returned object is the `signedData` shape
 * `lib/intents/verify-intent.ts` checks.
 */
export async function signIntentWithWallet(input: {
  standard: Exclude<IntentStandard, "webauthn">;
  payload: string | Record<string, unknown>;
  signer: WalletIntentSigner;
}): Promise<WalletSignedIntent> {
  const { standard, payload, signer } = input;

  if (standard === "nep413") {
    const envelope = asRecord(payload);
    if (!envelope) throw new Error(FAILED);

    const message = envelope.message;
    const recipient = envelope.recipient;
    const nonceValue = envelope.nonce;
    if (
      typeof message !== "string" ||
      typeof recipient !== "string" ||
      typeof nonceValue !== "string"
    ) {
      throw new Error(FAILED);
    }
    const nonce = decodeNep413Nonce(nonceValue);
    if (!nonce) throw new Error(FAILED);

    const signed = await signer.signNEP413({ message, recipient, nonce });
    if (!signed.signature || !signed.publicKey) throw new Error(FAILED);

    return {
      standard: "nep413",
      payload: envelope,
      signature: signed.signature,
      public_key: signed.publicKey,
    };
  }

  if (typeof payload !== "string") throw new Error(FAILED);

  let signatureBytes: Uint8Array;
  try {
    signatureBytes = await signer.signMessage(
      new TextEncoder().encode(payload),
    );
  } catch {
    throw new Error(FAILED);
  }
  if (!signatureBytes || signatureBytes.length === 0) throw new Error(FAILED);

  if (standard === "erc191") {
    return {
      standard,
      payload,
      signature: `0x${toHex(signatureBytes)}`,
    };
  }

  return { standard, payload, signature: toHex(signatureBytes) };
}
