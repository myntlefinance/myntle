import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "../context";
import type { Capability } from "../capability";

export const GET_TRANSACTION_STATUS_CAPABILITY: Capability = {
  tool: "get_transaction_status",
  tier: "read-public",
  subject: "any-address",
  approval: "none",
  attribution: "none",
  promptTerms: ["get_transaction_status"],
};

export function createTransactionStatusTool(_context?: ToolContext) {
  return tool({
    description:
      "Check the authoritative status of a trade that has already been submitted. " +
      "Returns whether it settled, is still processing, was refunded, or failed.",
    inputSchema: z.object({
      depositAddress: z
        .string()
        .describe("The deposit address the trade was given"),
    }),
    execute: async ({ depositAddress }) => {
      const { getStatus } = await import("@/lib/intents/service");
      const status = await getStatus(depositAddress);
      return {
        state: status.state,
        amountOut: status.amountOut,
        explorerUrls: status.explorerUrls,
      };
    },
  });
}

export const getTransactionStatus = createTransactionStatusTool();
