"use client";

import type { NearWalletBase } from "@hot-labs/near-connect";

/**
 * Build and send one NEAR deposit from a near-connect wallet.
 *
 * NEP-141 tokens travel as `ft_transfer`; native NEAR wraps to wNEAR first,
 * then transfers in the same batch. The amount is the exact smallest-unit
 * amount from the deposit record.
 */
export async function sendNearDepositWithWallet(
  wallet: NearWalletBase,
  input: {
    depositAddress: string;
    amount: string;
    tokenContract?: string | null;
  },
): Promise<string> {
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
                args: {
                  receiver_id: input.depositAddress,
                  amount: input.amount,
                },
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
                args: {
                  receiver_id: input.depositAddress,
                  amount: input.amount,
                },
                gas: "50000000000000",
                deposit: "1",
              },
            },
          ],
        },
      ];

  const withSend = wallet as unknown as {
    signAndSendTransactions?: (args: {
      transactions: typeof txs;
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
  const result = withSend.signAndSendTransactions
    ? await withSend.signAndSendTransactions({ transactions: txs })
    : await withSend.signAndSendTransaction?.(txs[0]);
  const first = Array.isArray(result) ? result[0] : result;
  const hash =
    (first as { transaction?: { hash?: string } } | undefined)?.transaction
      ?.hash ??
    (result as { transaction?: { hash?: string } } | undefined)?.transaction
      ?.hash ??
    (first as { hash?: string } | undefined)?.hash ??
    (result as { hash?: string } | undefined)?.hash;
  if (typeof hash !== "string" || hash.length === 0) {
    throw new Error("Deposit did not return a transaction hash");
  }
  return hash;
}
