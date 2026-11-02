import { tool } from "ai";
import { z } from "zod";
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

export function createQuoteTool(context?: ToolContext) {
  return tool({
    description:
      "Ask for a price on a trade. Returns the amount received, the minimum amount that " +
      "is guaranteed, the rate, and when the quote expires. Use this before proposing a " +
      "trade, and pass the figures through unchanged.",
    inputSchema: z.object({
      fromAssetId: z.string().describe("Full asset id of the token being sold"),
      toAssetId: z.string().describe("Full asset id of the token being bought"),
      amount: z
        .string()
        .describe("Amount in the smallest unit of the token being sold"),
      recipient: z
        .string()
        .optional()
        .describe(
          "The account that receives the output. Defaults to connected wallet address.",
        ),
      slippageBps: z.number().int().min(1).max(300).default(100),
    }),
    execute: async ({
      fromAssetId,
      toAssetId,
      amount,
      recipient,
      slippageBps,
    }) => {
      const targetRecipient = recipient || context?.activeAddress;
      if (!targetRecipient) {
        throw new Error(
          "No recipient specified and no connected wallet address found.",
        );
      }

      if (fromAssetId === toAssetId) {
        throw new Error(
          "The two assets are the same. Pick two different asset ids before pricing.",
        );
      }

      const { quote } = await import("@/lib/intents/service");
      const q = await quote({
        fromAssetId,
        toAssetId,
        amount,
        recipient: targetRecipient,
        slippageBps,
      });

      return {
        engine: q.engine,
        amountIn: q.amountInFormatted,
        amountOut: q.amountOutFormatted,
        minAmountOut: q.minAmountOut,
        minAmountOutRaw: q.minAmountOutRaw,
        rate: q.rate,
        amountOutUsd: q.amountOutUsd,
        expiresAt: q.expiresAt,
      };
    },
  });
}

export const getQuote = createQuoteTool();
