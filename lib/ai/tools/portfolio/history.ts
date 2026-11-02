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

export function createTransactionHistoryTool(_context?: ToolContext) {
  return tool({
    description: "List the trades this account has already made.",
    inputSchema: z.object({}),
    execute: async () => {
      return { trades: [], note: "History is not available yet." };
    },
  });
}

export const getTransactionHistory = createTransactionHistoryTool();
