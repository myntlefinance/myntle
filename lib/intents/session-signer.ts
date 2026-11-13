"use client";

import { PasskeyError } from "@/lib/auth/passkey-client";
import { signIntentWithPasskey } from "@/lib/auth/passkey-signer";
import type { SessionIdentity } from "@/lib/auth/session-identity";
import type { ConnectedWallet } from "@/lib/wallet/types";
import type { IntentStandard } from "./service";
import {
  signIntentWithWallet,
  WALLET_NOT_CONNECTED,
  type WalletIntentSigner,
} from "./wallet-signer";

/**
 * One signer for one session.
 *
 * A passkey account signs the WebAuthn payload with its credential; a wallet
 * account signs the same stored payload with the standard its chain uses. The
 * server picked that standard from the session, and only a passkey session may
 * answer a `webauthn` payload, so the two never cross over.
 *
 * The same implementation serves every card that signs an Intents payload, so
 * a rule tightened here applies to the withdrawal card and the sentence card
 * alike.
 */

export type IntentSigner = (intent: {
  standard: IntentStandard;
  payload: string | Record<string, unknown>;
}) => Promise<Record<string, unknown>>;

export type SessionSignerInput = {
  identity: SessionIdentity | null;
  account: ConnectedWallet | null;
  signMessage: WalletIntentSigner["signMessage"];
  signNEP413: WalletIntentSigner["signNEP413"];
};

/** The signer this session authorises, ready to hand to an intent card. */
export function signIntentForSession(input: SessionSignerInput): IntentSigner {
  const { identity, account, signMessage, signNEP413 } = input;

  return async ({ standard, payload }) => {
    if (identity?.kind === "passkey") {
      if (standard !== "webauthn" || typeof payload !== "string") {
        throw new PasskeyError(
          "This account signs with a passkey. Nothing was moved.",
        );
      }
      return signIntentWithPasskey(payload, {
        credentialId: identity.credentialId,
        publicKey: identity.publicKey,
        rpId: identity.rpId,
      });
    }

    if (standard === "webauthn") {
      throw new Error("This account signs with a wallet. Nothing was moved.");
    }
    if (!account) throw new Error(WALLET_NOT_CONNECTED);
    return signIntentWithWallet({
      standard,
      payload,
      signer: { signMessage, signNEP413 },
      publicKey: account.publicKey || undefined,
    });
  };
}
