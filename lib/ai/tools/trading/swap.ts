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
      "agreed on a pair and an amount, and only with figures that came from get_quote. " +
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
      fromAssetId: z.string().describe("Full asset id of the token being sold"),
      toAssetId: z.string().describe("Full asset id of the token being bought"),
      amount: z
        .string()
        .describe("Amount in the smallest unit of the token being sold"),
      recipient: z.string().describe("The account that receives the output"),
      slippageBps: z.number().int().min(1).max(300).default(100),
    }),
    // No execute function. The tool waits for the user to approve it.
  });
}

export const prepareSwap = createPrepareSwapTool();
