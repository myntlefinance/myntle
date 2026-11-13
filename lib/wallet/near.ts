"use client";

import { useNearWallet } from "near-connect-hooks";
import { useCallback, useMemo, useState } from "react";
import { fromHex, toHex, type ConnectedWallet } from "./types";
import {
  nearTransactionHash,
  sendNearDepositWithWallet,
} from "./near-transfer";

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
    connector,
  } = useNearWallet();

  /**
   * The account the wallet refuses to release, pinned out of the interface.
   *
   * A NEAR wallet can reject the sign-out request, and near-connect only
   * clears its account after the wallet agrees. Without this pin the app
   * would keep reporting a connected account after a confirmed sign-out,
   * leaving the account button on "Sign In".
   */
  const [revoked, setRevoked] = useState<string | null>(null);

  const account = useMemo<ConnectedWallet | null>(() => {
    if (!signedAccountId || signedAccountId === revoked) return null;

    return {
      kind: "near",
      standard: "nep413",
      address: signedAccountId,
      signerId: signedAccountId,
      // The public key is not known here without a second read, and the
      // verifier can recover it from the signature, so it is left empty.
      publicKey: "",
    };
  }, [revoked, signedAccountId]);

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
    connect: async (): Promise<string> => {
      // A fresh connection lifts the pin from a previous sign-out.
      setRevoked(null);
      await signIn();
      // signIn resolves after the wallet approves. The hook state updates on
      // the next render, so read the authorised account from the connector
      // as the source of truth, with the hook state as the fallback.
      try {
        const wallet = await connector.wallet();
        const accounts = await wallet.getAccounts();
        const id = accounts[0]?.accountId ?? signedAccountId;
        if (!id) throw new Error("NEAR wallet did not share an account");
        return id;
      } catch (cause) {
        if (signedAccountId) return signedAccountId;
        throw cause instanceof Error
          ? cause
          : new Error("NEAR wallet did not share an account");
      }
    },
    disconnect: async () => {
      // Pin the account out of the interface before asking the wallet, then
      // do not wait on the request: the wallet may show a prompt or refuse
      // outright, and neither may hold up the sign-out the user confirmed.
      setRevoked(signedAccountId || null);
      void signOut()
        // The hook cleared its own account, so the pin has done its job and
        // must not outlive the account it was set for. A refusal leaves the
        // pin in place, which keeps the app signed out anyway.
        .then(() => setRevoked(null))
        .catch(() => {});
    },
    signMessage: sign,
    signNEP413: signNEP413Message,
    /**
     * The public key the wallet will sign with, for the NEAR setup check.
     * Some wallets do not expose it here; the signed-in session stores the
     * key that verified, and the setup routes fall back to it.
     */
    getPublicKey: async (): Promise<string | null> => {
      const wallet = await connector.wallet();
      const accounts = await wallet.getAccounts();
      const active =
        accounts.find((entry) => entry.accountId === signedAccountId) ??
        accounts[0];
      return active?.publicKey ?? null;
    },
    /**
     * Registers the wallet key with `intents.near`.
     *
     * A named NEAR account needs this one-time transaction before it can
     * authenticate. The network fee was already sent to the account by the
     * setup faucet. The contract stores the key under the transaction's
     * signer, so this must be sent by the wallet's own account.
     */
    registerIntentsKey: async (publicKey: string): Promise<string> => {
      const wallet = await connector.wallet();
      const result = await wallet.signAndSendTransaction({
        receiverId: "intents.near",
        actions: [
          {
            type: "FunctionCall",
            params: {
              methodName: "add_public_key",
              args: { public_key: publicKey },
              gas: "100000000000000",
              deposit: "1",
            },
          },
        ],
      });
      const hash = nearTransactionHash(result);
      if (!hash) {
        throw new Error("The registration did not return a transaction hash.");
      }
      return hash;
    },
    /**
     * Funds the 1Click deposit address from the connected NEAR wallet.
     *
     * NEP-141 tokens travel as `ft_transfer`. Native NEAR wraps to wNEAR
     * first, then transfers in the same batch. The amount must be the exact
     * `amountIn` from the wet quote.
     */
    sendDeposit: async (input: {
      depositAddress: string;
      amount: string;
      tokenContract?: string | null;
    }): Promise<string> => {
      const wallet = await connector.wallet();
      return sendNearDepositWithWallet(wallet, input);
    },
  };
}

export { toHex };
