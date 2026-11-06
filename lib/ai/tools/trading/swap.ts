import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "../context";
import type { Capability } from "../capability";

export const PREPARE_SWAP_CAPABILITY: Capability = {
  tool: "prepare_swap",
  tier: "act",
  subject: "session",
  approval: "user-approval",
  attribution: "required",
  promptTerms: ["prepare_swap"],
};

export function createPrepareSwapTool(_context?: ToolContext) {
  return tool({
    description:
      "Propose a trade for the user to approve. Returns the exact parameters that will " +
      "be signed, and waits for the user's decision. Call this only after the user has " +
      "agreed on a pair and an amount, and only with figures that came from get_quote " +
      "in this same turn — figures from an earlier turn leave the card with " +
      "nothing to sign. " +
      "Set action to deposit when the user funds their own balance — including " +
      "the same ticker in and out to their own address — withdraw when they " +
      "take funds out to an address, bridge when the same asset moves across " +
      "chains to a different address, trade when they say trade without more " +
      "detail, and swap for every other exchange.",
    inputSchema: z.object({
      action: z
        .enum(["deposit", "swap", "bridge", "withdraw", "trade"])
        .default("swap")
        .describe("What the user asked to do with their money"),
      fromAssetId: z.string().min(1).describe("Full asset id of the token being sold"),
      toAssetId: z.string().min(1).describe("Full asset id of the token being bought"),
      amount: z
        .string()
        .min(1)
        .regex(/^\d+$/, "Amount must be digits only, in the smallest unit")
        .describe("Amount in the smallest unit of the token being sold"),
      recipient: z.string().min(1).describe("The account that receives the output"),
      refundTo: z
        .string()
        .min(1)
        .optional()
        .describe(
          "The account refunds return to on the origin chain. Defaults to the connected wallet.",
        ),
      slippageBps: z.number().int().min(1).max(300).default(100),
    }),
    // No settlement happens here. The interface signs the exact parameters
    // and POSTs them to /api/approve, which starts the durable workflow.
    // This only acknowledges the decision so the turn — and every later
    // turn that resends this history — carries a tool result. Without it,
    // an approved call has no output, the provider rejects the resubmitted
    // history, and every following message fails.
    execute: async (input) => {
      return {
        acknowledged: true,
        action: input.action,
        fromAssetId: input.fromAssetId,
        toAssetId: input.toAssetId,
        amount: input.amount,
        recipient: input.recipient,
        refundTo: input.refundTo ?? null,
        note: "The user approved this trade in the interface. Settlement is handled separately by the application. Do not call prepare_swap again for it unless the user asks for a new trade.",
      };
    },
  });
}

export const prepareSwap = createPrepareSwapTool();
