import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "../context";
import type { Capability } from "../capability";

export const GET_TRANSACTION_HISTORY_CAPABILITY: Capability = {
  tool: "get_transaction_history",
  tier: "read-private",
  subject: "session",
  approval: "none",
  attribution: "none",
  promptTerms: ["get_transaction_history"],
};

const StateFilter = z
  .enum([
    "submitted",
    "pending",
    "processing",
    "settled",
    "refunded",
    "failed",
    "incomplete_deposit",
    "needs_reconciliation",
  ])
  .optional()
  .describe("Only trades currently in this settlement state.");

export function createTransactionHistoryTool(context?: ToolContext) {
  return tool({
    description:
      "List the trades and deposits this account has already made, newest first. " +
      "Use this whenever the user asks what they have traded, deposited, or what their history looks like. " +
      "The full record also lives on the history page.",
    inputSchema: z.object({
      state: StateFilter,
      limit: z
        .number()
        .int()
        .min(1)
        .max(20)
        .default(10)
        .describe("How many of the newest trades to list."),
    }),
    execute: async ({ state, limit }) => {
      // The session id is authoritative and also covers a passkey account,
      // which has no connected wallet to look up. The wallet read is the
      // fallback for a caller that carries only the connected address.
      let userId = context?.userId ?? null;
      if (!userId) {
        const chain = context?.activeChain;
        const address = context?.activeAddress;
        if (
          (chain === "evm" || chain === "solana" || chain === "near") &&
          address
        ) {
          const { findUserIdByWallet } = await import("@/lib/db/wallets");
          userId = await findUserIdByWallet(chain, address);
        }
      }
      if (!userId) {
        return {
          trades: [],
          note: "No signed-in account is attached to this conversation, so there is no history to show.",
        };
      }

      const { listUserTransactions } = await import(
        "@/lib/db/transactions"
      );
      const { items } = await listUserTransactions(userId, {
        limit,
        state: state ?? null,
      });
      return {
        trades: items.map((t) => ({
          id: t.id,
          state: t.state,
          originAsset: t.originAsset,
          destinationAsset: t.destinationAsset,
          amountIn: t.amountIn,
          expectedOut: t.expectedOut,
          amountOut: t.amountOut,
          createdAt: t.createdAt,
          depositAddress: t.depositAddress,
          explorerUrls: t.explorerUrls,
        })),
      };
    },
  });
}

export const getTransactionHistory = createTransactionHistoryTool();
