import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "../context";
import type { Capability } from "../capability";
import type { SwapStatus } from "@/lib/intents/service";
import type { LimitOrderView } from "@/lib/intents/orders";

export const GET_TRANSACTION_STATUS_CAPABILITY: Capability = {
  tool: "get_transaction_status",
  tier: "read-private",
  subject: "session",
  approval: "none",
  attribution: "none",
  promptTerms: ["get_transaction_status"],
};

export const transactionStatusInputSchema = z.object({
  transactionId: z
    .string()
    .min(1)
    .optional()
    .describe(
      "The transaction id from get_transaction_history. Pass it when the user means a specific trade.",
    ),
  depositAddress: z
    .string()
    .min(1)
    .optional()
    .describe(
      "The one-time deposit address shown with one of this account's trades. " +
        "Only the account's own addresses are read.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(5)
    .default(3)
    .describe(
      "How many of the newest trades to check when the user named no specific one.",
    ),
});

type LiveCheck =
  | { status: SwapStatus }
  | { order: LimitOrderView }
  | { error: string }
  | { skipped: string };

/**
 * A record that has not reached submission has no settlement to check. The
 * deposit address may exist because the quote minted it, and 1Click will
 * truthfully say it is waiting for funds, but the user has not approved or
 * signed the trade yet; reporting that as a pending settlement would tell
 * them to wait for something that is still theirs to start.
 */
const PRE_SUBMISSION = new Set([
  "draft",
  "quoted",
  "awaiting_approval",
  "authorized",
]);

/**
 * Resolves the account that owns the record.
 *
 * The session id is authoritative. The wallet lookup is the fallback for a
 * caller that carries only the connected address, so the tool never reads a
 * record from an address the session did not authenticate.
 */
async function resolveUserId(context?: ToolContext): Promise<string | null> {
  if (context?.userId) return context.userId;
  const chain = context?.activeChain;
  const address = context?.activeAddress;
  if (
    (chain === "evm" || chain === "solana" || chain === "near") &&
    address
  ) {
    const { findUserIdByWallet } = await import("@/lib/db/wallets");
    return findUserIdByWallet(chain, address);
  }
  return null;
}

export function createTransactionStatusTool(context?: ToolContext) {
  return tool({
    description:
      "Check the settlement status of this account's trades and deposits. " +
      "Reads the stored record and asks 1Click for the authoritative state, " +
      "returning whether it settled, is still waiting or processing, was " +
      "refunded, or failed. Call it with no arguments to check the newest " +
      "trades, or pass transactionId when the user means a specific one.",
    inputSchema: transactionStatusInputSchema,
    execute: async ({ transactionId, depositAddress, limit }) => {
      const userId = await resolveUserId(context);
      if (!userId) {
        return {
          transactions: [],
          note: "No signed-in account is attached to this conversation, so there is no transaction record to check.",
        };
      }

      const { findStatusRecords } = await import("@/lib/db/transactions");
      let records: Awaited<ReturnType<typeof findStatusRecords>>;
      try {
        records = await findStatusRecords(userId, {
          ...(transactionId ? { id: transactionId } : {}),
          ...(depositAddress ? { depositAddress } : {}),
          limit,
        });
      } catch {
        return {
          transactions: [],
          note: "The transaction record could not be read just now.",
        };
      }

      if (records.length === 0) {
        return {
          transactions: [],
          note:
            transactionId || depositAddress
              ? "No trade in this account's record matches that reference."
              : "This account has no trades yet.",
        };
      }

      const { getAssets, getStatus } = await import("@/lib/intents/service");
      const { getLimitOrder, limitOrderFilledAmounts, limitOrderTransactionState } =
        await import("@/lib/intents/orders");
      // The catalogue is already cached by the price layer, and it is the
      // only place the two asset ids gain the tickers the user recognizes.
      // It loads alongside the checks so a cold catalogue never delays the
      // answer the user is waiting for.
      const [assets, checks] = await Promise.all([
        getAssets().catch((): Awaited<ReturnType<typeof getAssets>> => []),
        Promise.all(
          records.map(async (record): Promise<LiveCheck> => {
            if (PRE_SUBMISSION.has(record.state)) {
              return {
                skipped:
                  "This trade has not been submitted yet; it is waiting for the user's approval or signature.",
              };
            }
            // A limit order is read from the order endpoint. The deposit
            // status endpoint cannot see it, so calling it would always look
            // like a failure rather than a resting order.
            if (record.kind === "limit_order" && record.orderId) {
              try {
                return { order: await getLimitOrder(record.orderId) };
              } catch {
                return {
                  error:
                    "The live order check is unavailable; this is the stored record.",
                };
              }
            }
            if (!record.depositAddress) {
              return {
                error: "The record carries no deposit address to check.",
              };
            }
            try {
              return {
                status: await getStatus(
                  record.depositAddress,
                  record.depositMemo,
                  {
                    originAssetId: record.originAsset,
                    destinationAssetId: record.destinationAsset,
                  },
                ),
              };
            } catch {
              return {
                error:
                  "The live settlement check is unavailable; this is the stored record.",
              };
            }
          }),
        ),
      ]);
      const symbols = new Map(
        assets.map((asset) => [asset.assetId, asset.symbol]),
      );

      const transactions = records.map((record, index) => {
        const check = checks[index];
        const live = "status" in check ? check.status : null;
        const orderView = "order" in check ? check.order : null;
        const skipped = "skipped" in check ? check.skipped : null;
        const statusError =
          "error" in check
            ? check.error
            : "The live settlement check is unavailable; this is the stored record.";
        const mappedOrder = orderView
          ? limitOrderTransactionState(orderView)
          : null;
        const filled = orderView ? limitOrderFilledAmounts(orderView) : null;
        return {
          id: record.id,
          // The live state is what the assistant should report once a trade
          // is submitted. The stored state travels beside it so a stale
          // record is visible rather than silently presented as settlement.
          // A funding window the app already closed outranks a live
          // PENDING_DEPOSIT: the address is no longer inviting funds.
          state: skipped
            ? record.state
            : mappedOrder
              ? mappedOrder.state
              : live?.state === "pending" && record.state === "expired"
                ? "expired"
                : (live?.state ?? record.state),
          recordState: record.state,
          ...(orderView
            ? {
                orderId: orderView.orderId,
                side: orderView.side,
                quantity: orderView.quantity,
                price: orderView.price,
                fillStatus: orderView.fillStatus,
                payoutStatus: orderView.payoutStatus,
                isPayoutStatusFinal: orderView.isPayoutStatusFinal,
                partialFillCount: orderView.partialFills.length,
                ...(orderView.depositedAmount
                  ? { depositedAmount: orderView.depositedAmount }
                  : {}),
                ...(orderView.depositedAmountFormatted
                  ? {
                      depositedAmountFormatted:
                        orderView.depositedAmountFormatted,
                    }
                  : {}),
                ...(filled?.amountIn
                  ? { filledAmountIn: filled.amountIn }
                  : {}),
                ...(filled?.amountOut
                  ? { filledAmountOut: filled.amountOut }
                  : {}),
                ...(orderView.deadline
                  ? { deadline: orderView.deadline }
                  : {}),
              }
            : live
              ? {
                  settlementStatus: live.status,
                  ...(live.amountIn ? { amountIn: live.amountIn } : {}),
                  ...(live.amountOut ? { amountOut: live.amountOut } : {}),
                  ...(live.amountOutUsd
                    ? { amountOutUsd: live.amountOutUsd }
                    : {}),
                  ...(live.depositedAmount
                    ? { depositedAmount: live.depositedAmount }
                    : {}),
                  ...(live.refundedAmount
                    ? { refundedAmount: live.refundedAmount }
                    : {}),
                  ...(live.refundReason
                    ? { refundReason: live.refundReason }
                    : {}),
                  ...(live.updatedAt ? { updatedAt: live.updatedAt } : {}),
                }
              : skipped
                ? { note: skipped }
                : { statusError }),
          originAsset: record.originAsset,
          destinationAsset: record.destinationAsset,
          ...(record.originAsset && symbols.get(record.originAsset)
            ? { originSymbol: symbols.get(record.originAsset) }
            : {}),
          ...(record.destinationAsset && symbols.get(record.destinationAsset)
            ? { destinationSymbol: symbols.get(record.destinationAsset) }
            : {}),
          ...(!live?.amountIn && record.amountIn
            ? { amountIn: record.amountIn }
            : {}),
          expectedOut: record.expectedOut,
          amountOut: live?.amountOut ?? record.amountOut,
          ...(record.expiresAt ? { expiresAt: record.expiresAt } : {}),
          explorerUrls:
            live && live.explorerUrls.length > 0
              ? live.explorerUrls
              : record.explorerUrls,
          createdAt: record.createdAt,
        };
      });

      // The newest record also fills the flat fields older stored turns use,
      // so the activity line can render both shapes without a migration.
      const primary = transactions[0];
      return {
        state: primary.state,
        ...(primary.amountOut ? { amountOut: primary.amountOut } : {}),
        transactions,
      };
    },
  });
}

export const getTransactionStatus = createTransactionStatusTool();
