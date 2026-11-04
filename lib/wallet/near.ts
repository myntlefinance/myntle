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
    connector,
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
    connect: async (): Promise<string> => {      await signIn();
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
      await signOut();
    },
    signMessage: sign,
    signNEP413: signNEP413Message,
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
      const withSend = wallet as unknown as {
        signAndSendTransactions?: (args: {
          transactions: Array<{
            receiverId: string;
            actions: Array<{
              type: string;
              params: {
                methodName: string;
                args: Record<string, unknown>;
                gas: string;
                deposit: string;
              };
            }>;
          }>;
        }) => Promise<unknown>;
        signAndSendTransaction?: (args: {
          receiverId: string;
          actions: Array<{
            type: string;
            params: {
              methodName: string;
              args: Record<string, unknown>;
              gas: string;
              deposit: string;
            };
          }>;
        }) => Promise<unknown>;
      };
      const txs = !input.tokenContract
        ? [
            {
              receiverId: "wrap.near",
              actions: [
                {
                  type: "FunctionCall",
                  params: {
                    methodName: "near_deposit",
                    args: {},
                    gas: "30000000000000",
                    deposit: input.amount,
                  },
                },
                {
                  type: "FunctionCall",
                  params: {
                    methodName: "ft_transfer",
                    args: { receiver_id: input.depositAddress, amount: input.amount },
                    gas: "50000000000000",
                    deposit: "1",
                  },
                },
              ],
            },
          ]
        : [
            {
              receiverId: input.tokenContract,
              actions: [
                {
                  type: "FunctionCall",
                  params: {
                    methodName: "ft_transfer",
                    args: { receiver_id: input.depositAddress, amount: input.amount },
                    gas: "50000000000000",
                    deposit: "1",
                  },
                },
              ],
            },
          ];
      const result = withSend.signAndSendTransactions
        ? await withSend.signAndSendTransactions({ transactions: txs })
        : await withSend.signAndSendTransaction?.(txs[0]);
      const first = Array.isArray(result) ? result[0] : result;
      const hash =
        (first as { transaction?: { hash?: string } } | undefined)?.transaction?.hash ??
        (result as { transaction?: { hash?: string } } | undefined)?.transaction?.hash ??
        (first as { hash?: string } | undefined)?.hash ??
        (result as { hash?: string } | undefined)?.hash;
      if (typeof hash !== "string" || hash.length === 0) {
        throw new Error("Deposit did not return a transaction hash");
      }
      return hash;
    },
  };
}

export { toHex };
