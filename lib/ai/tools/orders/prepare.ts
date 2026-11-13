import { tool } from "ai";
import { z } from "zod";
import type { Capability } from "../capability";

export const PREPARE_LIMIT_ORDER_CAPABILITY: Capability = {
  tool: "prepare_limit_order",
  tier: "act",
  subject: "session",
  approval: "user-approval",
  attribution: "none",
  promptTerms: ["prepare_limit_order"],
};

/**
 * The one proposal tool for the limit-order route.
 *
 * It accepts only the quote id. The assets, the side, the quantity, the price,
 * the funding account, and the recipient are all rebuilt by
 * `/api/orders` from the stored quote row, so the model cannot move a figure
 * between pricing and approval.
 */
export const prepareLimitOrderInputSchema = z.strictObject({
  quoteId: z
    .string()
    .uuid()
    .describe("The quote id returned by get_limit_order_quote in this turn"),
});

export function createPrepareLimitOrderTool() {
  return tool({
    description:
      "Propose a limit order for the user to approve. Call this only after " +
      "get_limit_order_quote priced the same order in this turn, and pass its quote id " +
      "unchanged. The interface creates the order from the stored quote and shows the " +
      "funding details. This call only acknowledges; it never creates an order or moves money.",
    inputSchema: prepareLimitOrderInputSchema,
    // The tool returns an acknowledgement so the turn, and every later turn
    // that resends this history, carries a tool result. Without it, an
    // approved call has no output and the provider rejects the history.
    execute: async ({ quoteId }) => {
      return {
        acknowledged: true,
        quoteId,
        note: "The user approved this limit order in the interface. The application creates the order and returns the funding details separately. Do not call prepare_limit_order again for it unless the user asks for a new order.",
      };
    },
  });
}

export const prepareLimitOrder = createPrepareLimitOrderTool();
