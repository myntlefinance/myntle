import { tool } from "ai";
import { z } from "zod";
import type { Capability } from "../capability";

export const REQUEST_SUPER_UNLOCK_CAPABILITY: Capability = {
  tool: "request_super_unlock",
  tier: "read-public",
  subject: "session",
  approval: "none",
  attribution: "none",
  promptTerms: ["request_super_unlock", "super account"],
};

/**
 * The deterministic redirect to the super account.
 *
 * The model calls this instead of acting when the user wants something
 * balance-backed while locked: private holdings, a deposit to super, limit
 * orders, perps, yield, or private history. The output wording is fixed —
 * only the WHEN is the model's call — and the interface opens the unlock
 * dialog from it. Never money movement, never an approval.
 */
export function createRequestSuperUnlockTool() {
  return tool({
    description:
      "Ask the user to unlock their super account. Call this when the user " +
      "wants private holdings, a deposit to their super account, limit " +
      "orders, perps, yield, or private history, and their super account " +
      "is locked. Do not call anything balance-backed afterwards — stop " +
      "after this call and wait for the user.",
    inputSchema: z.object({
      wanted: z
        .string()
        .min(1)
        .max(200)
        .describe(
          "What the user asked for that needs the super account, in their words",
        ),
    }),
    execute: async ({ wanted }) => {
      return {
        needsSuperUnlock: true,
        wanted,
        message:
          "The super account is still locked. Opening unlock — one signature, nothing leaves the browser.",
      };
    },
  });
}

export const requestSuperUnlock = createRequestSuperUnlockTool();
