import { tool } from "ai";
import { z } from "zod";
import type { QuoteMode } from "@/lib/intents/service";
import type { ToolContext } from "../context";
import type { Capability } from "../capability";

export const GET_QUOTE_CAPABILITY: Capability = {
  tool: "get_quote",
  tier: "read-public",
  subject: "none",
  approval: "none",
  attribution: "none",
  promptTerms: ["get_quote"],
};

/** Where the trade's input comes from. Defaults follow the account kind. */
export type QuoteFunding = "confidential" | "wallet";

export function createQuoteTool(context?: ToolContext) {
  const accountKind = context?.accountKind ?? "wallet";

  return tool({
    description:
      "Ask for a price on a trade. Returns the amount received, the minimum amount that " +
      "is guaranteed, the rate, and when the quote expires. Use this before proposing a " +
      "trade, and pass the figures through unchanged. " +
      (accountKind === "passkey"
        ? "This account trades from its confidential balance, so leave funding at its default."
        : "Set funding to confidential to spend the confidential account balance, or wallet " +
          "to spend the connected wallet through the direct route."),
    inputSchema: z.object({
      fromAssetId: z.string().describe("Full asset id of the token being sold"),
      toAssetId: z.string().describe("Full asset id of the token being bought"),
      amount: z
        .string()
        .describe("Amount in the smallest unit of the token being sold"),
      funding: z
        .enum(["confidential", "wallet"])
        .optional()
        .describe(
          "Where the input comes from. Defaults to confidential for a passkey account " +
            "and wallet for a wallet account. A passkey account has no wallet, so wallet " +
            "funding is not available to it.",
        ),
      recipient: z
        .string()
        .optional()
        .describe(
          "The account that receives the output. Defaults to connected wallet address. " +
            "Ignored for a confidential quote, which pays the account itself.",
        ),
      slippageBps: z.number().int().min(1).max(300).default(100),
      refundTo: z
        .string()
        .optional()
        .describe(
          "The account refunds return to on the origin chain. Defaults to the connected wallet address. " +
            "Ignored for a confidential quote, which refunds to the account itself.",
        ),
      confidentiality: z
        .enum(["public", "basic", "advanced"])
        .default("basic")
        .describe(
          "Privacy level for the swap. Always basic or advanced; public is never used.",
        ),
    }),
    execute: async ({
      fromAssetId,
      toAssetId,
      amount,
      funding,
      recipient,
      slippageBps,
      refundTo,
      confidentiality,
    }) => {
      const resolvedFunding: QuoteFunding =
        funding ?? (accountKind === "passkey" ? "confidential" : "wallet");

      if (resolvedFunding === "wallet" && accountKind === "passkey") {
        throw new Error(
          "This account has no wallet. Price the trade from the confidential balance instead.",
        );
      }

      if (fromAssetId === toAssetId) {
        throw new Error(
          "The two assets are the same. Pick two different asset ids before pricing.",
        );
      }

      const confidential = resolvedFunding === "confidential";
      const intentsAccountId = context?.intentsAccountId?.trim() || null;
      if (confidential && !intentsAccountId) {
        throw new Error(
          "The account is not available. Sign in again before pricing a trade.",
        );
      }

      // A confidential quote belongs to the account, not to an address the
      // model supplied: the output and any refund land back in the same
      // confidential balance the trade spends from.
      const targetRecipient = confidential
        ? (intentsAccountId as string)
        : recipient || context?.activeAddress;
      if (!targetRecipient) {
        throw new Error(
          "No recipient specified and no connected wallet address found.",
        );
      }

      // Refunds must be valid on the origin chain, which the recipient
      // is not guaranteed to be. Default to the connected wallet.
      const targetRefundTo = confidential
        ? (intentsAccountId as string)
        : refundTo || context?.activeAddress || targetRecipient;

      // The product has one confidential mode; `public` on a confidential
      // quote would ask the verifier for the opposite of the thesis.
      const effectiveConfidentiality =
        confidential && confidentiality === "public"
          ? ("basic" as const)
          : confidentiality;

      const mode: QuoteMode = confidential ? "confidential-intents" : "chain";

      const { quote } = await import("@/lib/intents/service");
      const q = await quote({
        fromAssetId,
        toAssetId,
        amount,
        recipient: targetRecipient,
        refundTo: targetRefundTo,
        slippageBps,
        confidentiality: effectiveConfidentiality,
        mode,
      });

      // The dry preview is the server's record of what was priced. The
      // approval card carries its id, and the intent routes treat the stored
      // row as truth — browser figures that moved fail the comparison.
      // Logged-out previews still price; they just cannot be approved,
      // because approval requires the session the row is keyed to.
      let quoteId: string | null = null;
      const userId = context?.userId?.trim() || null;
      if (userId) {
        try {
          const { createQuote } = await import("@/lib/db/transactions");
          quoteId = await createQuote({
            userId,
            request: {
              fromAssetId,
              toAssetId,
              amount,
              recipient: targetRecipient,
              refundTo: targetRefundTo,
              slippageBps,
              confidentiality: effectiveConfidentiality,
              // The mode and the account kind are stored so an approval
              // cannot re-purpose this quote for another route or account.
              mode,
              accountKind,
              intentsAccountId,
            },
            response: {
              amountIn: q.amountIn,
              amountOut: q.amountOut,
              minAmountOutRaw: q.minAmountOutRaw,
              expiresAt: q.expiresAt,
            },
            expiresAt: q.expiresAt,
          });
        } catch {
          // A lost preview never blocks pricing; approval re-quotes live.
        }
      }

      return {
        engine: q.engine,
        mode,
        quoteId,
        amountIn: q.amountInFormatted,
        amountInRaw: q.amountIn,
        amountOut: q.amountOutFormatted,
        amountOutRaw: q.amountOut,
        minAmountOut: q.minAmountOut,
        minAmountOutRaw: q.minAmountOutRaw,
        rate: q.rate,
        feeBps: q.feeBps,
        amountOutUsd: q.amountOutUsd,
        expiresAt: q.expiresAt,
      };
    },
  });
}

export const getQuote = createQuoteTool();
