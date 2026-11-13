import { tool } from "ai";
import { z } from "zod";
import type { Capability } from "../capability";

export const PREPARE_WITHDRAWAL_CAPABILITY: Capability = {
  tool: "prepare_withdrawal",
  tier: "act",
  subject: "session",
  approval: "user-approval",
  // The card names the external address the money leaves for.
  attribution: "required",
  promptTerms: ["prepare_withdrawal"],
};

/**
 * Proposes a withdrawal for the user's decision.
 *
 * The tool only acknowledges. It does not price, it does not return a quote,
 * a deposit address, or a payload, and it never signs. The interface reads the
 * stored `get_withdrawal_quote` row and the approve route rebuilds the
 * destination from it, so the model cannot redirect a priced withdrawal.
 *
 * `destinationAddress` is echoed exactly as the user gave it, except that a
 * name is resolved server-side first: the acknowledgement carries the bound
 * address, never the string. The quote tool is where the chain-aware
 * validation happens.
 */
export const prepareWithdrawalInputSchema = z.object({
  fromAssetId: z
    .string()
    .min(1)
    .describe("Full asset id of the token leaving the private balance"),
  toAssetId: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Full asset id that arrives at the destination. Defaults to the asset leaving the account.",
    ),
  amount: z
    .string()
    .regex(
      /^[1-9]\d*$/,
      "Amount must be a positive whole number in the smallest unit",
    )
    .describe("Amount in the smallest unit of the token leaving the account"),
  destinationAddress: z
    .string()
    .min(1)
    .max(200)
    .describe(
      "The external address that receives the funds, exactly as the user gave it.",
    ),
});

export function createPrepareWithdrawalTool() {
  return tool({
    description:
      "Propose a withdrawal so the interface can ask the user to approve it. Call this only " +
      "after get_withdrawal_quote priced the same asset, amount, and destination in this turn. " +
      "The card shows the destination from the stored quote, and the user approves the transfer " +
      "with their passkey or wallet. A destination may be a name such as vitalik.eth; pass it " +
      "through unchanged. This call only acknowledges; it moves nothing.",
    inputSchema: prepareWithdrawalInputSchema,
    execute: async (input) => {
      // The acknowledgement binds the address, never the string: a name
      // resolves here so the echo matches the stored quote's destination.
      // Chain validation stays with the quote tool, which owns the chain.
      let destination = input.destinationAddress;
      const { isNameLikeValue, nameChainForInput } = await import(
        "@/lib/names/detect"
      );
      if (isNameLikeValue(destination)) {
        const { NameInputError, resolveInputAddress } = await import(
          "@/lib/names/binding"
        );
        try {
          const hit = await resolveInputAddress({
            value: destination,
            scope: nameChainForInput(destination),
            isDirectAddress: () => null,
          });
          destination = hit.address;
        } catch (error) {
          if (error instanceof NameInputError) {
            if (error.reason === "unregistered") {
              throw new Error(
                "That name is not registered. Ask the user for the full destination address.",
              );
            }
            if (error.reason === "unavailable") {
              throw new Error(
                "Name lookup is unavailable. Try again shortly.",
              );
            }
          }
          throw new Error(
            "That name is not valid. Ask the user for the full destination address.",
          );
        }
      }
      return {
        acknowledged: true,
        action: "withdraw",
        fromAssetId: input.fromAssetId,
        toAssetId: input.toAssetId ?? input.fromAssetId,
        amount: input.amount,
        destination,
        note: "The interface will show the destination and the fee from the stored quote. Do not call prepare_withdrawal again for this withdrawal unless the user asks for a new one.",
      };
    },
  });
}

export const prepareWithdrawal = createPrepareWithdrawalTool();
