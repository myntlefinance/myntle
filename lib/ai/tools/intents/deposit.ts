import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "../context";
import type { Capability } from "../capability";

export const PREPARE_DEPOSIT_CAPABILITY: Capability = {
  tool: "prepare_deposit",
  tier: "act",
  subject: "session",
  approval: "user-approval",
  attribution: "none",
  promptTerms: ["prepare_deposit"],
};

/**
 * Proposes funding the account from an external chain.
 *
 * The tool only acknowledges. It never returns an address and it never moves
 * money: the deposit card calls `/api/intents/deposit`, which mints the wet
 * quote from the session's own Intents account and returns the exact one-time
 * address. The model must not invent one, because a wrong address sends funds
 * to a place the account cannot spend from.
 */
export const prepareDepositInputSchema = z.object({
  assetId: z
    .string()
    .min(1)
    .describe("Full asset id of the token being deposited, including its chain"),
  amount: z
    .string()
    .regex(
      /^[1-9]\d*$/,
      "Amount must be a positive whole number in the smallest unit",
    )
    .describe("Amount in the smallest unit of the token being deposited"),
  source: z
    .enum(["external"])
    .optional()
    .describe(
      "Where the funds come from. A passkey account deposits from an external chain.",
    ),
});

export function createPrepareDepositTool(_context?: ToolContext) {
  return tool({
    description:
      "Propose a deposit into the account so the interface can show the exact one-time " +
      "address. Call this when the account balance is short of the amount the user wants " +
      "to move, or when they ask where to send funds. The user sends from an exchange or " +
      "another wallet. This call only acknowledges; it moves nothing and returns no address.",
    inputSchema: prepareDepositInputSchema,
    execute: async (input) => {
      return {
        acknowledged: true,
        action: "deposit",
        assetId: input.assetId,
        amount: input.amount,
        mode: "confidential-external",
        note: "The interface will show the exact deposit address.",
      };
    },
  });
}

export const prepareDeposit = createPrepareDepositTool();
