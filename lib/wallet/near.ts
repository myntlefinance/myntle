"use client";

import { useNearWallet } from "near-connect-hooks";
import { useCallback, useMemo } from "react";
import { fromHex, toHex, type ConnectedWallet } from "./types";

/**
 * The NEAR adapter.
 *
 * The signing standard is NEP-413, and the account the verifier knows is the
 * NEAR account id. A named account keeps its name, and an implicit account is
 * the sixty-four character hexadecimal form of the public key.
 */
export function useNearWalletAdapter() {
  const {
    signedAccountId,
    signNEP413Message,
    signIn,
    signOut,
    loading,
  } = useNearWallet();

  const account = useMemo<ConnectedWallet | null>(() => {
    if (!signedAccountId) return null;

    const implicit = /^[0-9a-f]{64}$/.test(signedAccountId);

    return {
      kind: "near",
      standard: "nep413",
      address: signedAccountId,
      signerId: signedAccountId,
      // The public key is not known here without a second read, and the
      // verifier can recover it from the signature, so it is left empty.
      publicKey: "",
    };
  }, [signedAccountId]);

  const sign = useCallback(
    async (payload: Uint8Array): Promise<Uint8Array> => {
      const signed = await signNEP413Message({
        message: new TextDecoder().decode(payload),
        recipient: "intents.near",
        nonce: payload.slice(0, 32),
      });
      return fromHex(signed.signature);
    },
    [signNEP413Message],
  );

  return {
    account,
    isConnected: !!account,
    isPending: loading,
    connect: async () => {
      await signIn();
    },
    disconnect: async () => {
      await signOut();
    },
    signMessage: sign,
  };
}

export { toHex };
