import { tool } from "ai";
import { z } from "zod";
import type { Asset } from "@/lib/intents/service";
import type { ToolContext } from "../context";
import type { Capability } from "../capability";

export const GET_WITHDRAWAL_QUOTE_CAPABILITY: Capability = {
  tool: "get_withdrawal_quote",
  tier: "read-public",
  subject: "none",
  approval: "none",
  attribution: "none",
  promptTerms: ["get_withdrawal_quote"],
};

/**
 * Prices a withdrawal from the private balance to an external address.
 *
 * This is the withdrawal half of `get_quote`: it reads the catalogue and the
 * 1Click quote endpoint, stores the dry preview against the signed-in user,
 * and returns the figures and the quote id. It never reads a balance, never
 * signs, and never moves money.
 *
 * The destination chain decides the address grammar, and the server chooses
 * the recipient type. Only EVM destinations were measured, so another chain
 * is refused with a plain reason rather than guessed at.
 */
export const getWithdrawalQuoteInputSchema = z.object({
  fromAssetId: z
    .string()
    .min(1)
    .describe("Full asset id of the token leaving the private balance"),
  toAssetId: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Full asset id that arrives at the destination. Defaults to the asset leaving the account, which is the measured same-asset withdrawal.",
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
      "The external address that receives the funds, exactly as the user gave it. Never shorten, correct, or invent one.",
    ),
});

export function createGetWithdrawalQuoteTool(context?: ToolContext) {
  return tool({
    description:
      "Price a withdrawal from the private balance to an external address. Call this after the " +
      "user names the asset, the amount, and the destination, and before prepare_withdrawal. " +
      "The server validates the destination against the destination asset's chain and stores " +
      "the exact address it will bind. A destination may be a name such as vitalik.eth; pass " +
      "it through unchanged. This call moves nothing and reads no balance.",
    inputSchema: getWithdrawalQuoteInputSchema,
    execute: async ({
      fromAssetId,
      toAssetId,
      amount,
      destinationAddress,
    }) => {
      const intentsAccountId = context?.intentsAccountId?.trim() || null;
      if (!intentsAccountId) {
        throw new Error(
          "The account is not available. Sign in again before pricing a withdrawal.",
        );
      }

      const destinationAssetId = toAssetId ?? fromAssetId;

      let assets: Asset[];
      try {
        const { getAssets } = await import("@/lib/intents/service");
        assets = await getAssets();
      } catch {
        throw new Error(
          "The asset catalogue is unavailable. Try again in a moment.",
        );
      }

      const fromAsset = assets.find((asset) => asset.assetId === fromAssetId);
      const toAsset = assets.find((asset) => asset.assetId === destinationAssetId);
      if (!fromAsset || !toAsset) {
        throw new Error(
          "That asset is not in the catalogue. Look it up with get_supported_assets first.",
        );
      }

      // A destination may be a name. It resolves server-side before pricing,
      // and the stored quote binds the resolved address, never the string.
      const validated = await validateWithdrawalDestination(
        toAsset.chain,
        destinationAddress,
      );
      const destination = validated.destination;
      const destinationName = validated.name;
      const destinationResolvedAt = validated.resolvedAt;

      const { quote } = await import("@/lib/intents/service");
      const priced = await quote({
        fromAssetId,
        toAssetId: destinationAssetId,
        amount,
        // The server owns the topology: the address comes from the user, but
        // the recipient type and the private refund are set here.
        recipient: destination.address,
        refundTo: intentsAccountId,
        slippageBps: 100,
        confidentiality: "basic",
        mode: "confidential-withdrawal",
      });

      // The dry preview is the server's record of what was priced. The
      // approval card carries its id, and the approve route rebuilds every
      // figure and the destination from this row.
      let quoteId: string | null = null;
      const userId = context?.userId?.trim() || null;
      if (userId) {
        try {
          const { createQuote } = await import("@/lib/db/transactions");
          quoteId = await createQuote({
            userId,
            request: {
              fromAssetId,
              toAssetId: destinationAssetId,
              amount,
              recipient: destination.address,
              refundTo: intentsAccountId,
              slippageBps: 100,
              confidentiality: "basic",
              mode: "confidential-withdrawal",
              recipientType: "DESTINATION_CHAIN",
              refundType: "CONFIDENTIAL_INTENTS",
              destination: destination.address,
              destinationChain: toAsset.chain,
              // The name the destination resolved from, when one was passed.
              // The approve route re-resolves it fresh: a name can be
              // re-pointed between pricing and approval.
              destinationName,
              destinationResolvedAt,
              accountKind: context?.accountKind ?? "wallet",
              intentsAccountId,
            },
            response: {
              amountIn: priced.amountIn,
              amountOut: priced.amountOut,
              minAmountOutRaw: priced.minAmountOutRaw,
              withdrawFee: priced.withdrawFee,
              withdrawFeeFormatted: priced.withdrawFeeFormatted,
              expiresAt: priced.expiresAt,
            },
            expiresAt: priced.expiresAt,
          });
        } catch {
          // A lost preview never blocks pricing; approval re-quotes live.
        }
      }

      return {
        engine: priced.engine,
        quoteId,
        fromAssetId,
        toAssetId: destinationAssetId,
        amountIn: priced.amountInFormatted,
        amountInRaw: priced.amountIn,
        amountOut: priced.amountOutFormatted,
        amountOutRaw: priced.amountOut,
        minAmountOut: priced.minAmountOut,
        minAmountOutRaw: priced.minAmountOutRaw,
        withdrawFee: priced.withdrawFee ?? null,
        withdrawFeeFormatted: priced.withdrawFeeFormatted ?? null,
        destination: destination.address,
        destinationChain: toAsset.chain,
        // Echoed when the destination was passed as a name; the model
        // already supplied it, so this leaks nothing.
        destinationName,
        expiresAt: priced.expiresAt,
      };
    },
  });
}

export const getWithdrawalQuote = createGetWithdrawalQuoteTool();

/**
 * Validates a withdrawal destination: a direct address takes the existing
 * chain-aware check untouched, and a name resolves fresh through the port.
 * Errors keep the existing voice: unregistered asks for the address, a
 * lookup failure asks for a retry, anything else is the invalid-address
 * sentence the tool already used.
 */
async function validateWithdrawalDestination(
  chain: string,
  destinationAddress: string,
): Promise<{
  destination: { address: string; chain: string };
  name: string | null;
  resolvedAt: string | null;
}> {
  const { checkDestinationForAsset } = await import(
    "@/lib/intents/destination"
  );
  const direct = checkDestinationForAsset(chain, destinationAddress);
  if (direct.ok) {
    return { destination: direct, name: null, resolvedAt: null };
  }
  if (direct.reason === "unsupported-chain") {
    throw new Error(
      `Withdrawals to ${chain} are not available yet. Use an EVM destination.`,
    );
  }
  if (direct.reason === "unknown-chain") {
    throw new Error(
      "The destination chain is not in the catalogue. Ask the user which chain to send to.",
    );
  }
  const invalid = () =>
    new Error(
      `The destination is not a valid address on ${chain}. Ask the user for the full address.`,
    );
  const { isNameLikeValue } = await import("@/lib/names/detect");
  if (!isNameLikeValue(destinationAddress)) throw invalid();
  const { NameInputError, resolveInputAddress } = await import(
    "@/lib/names/binding"
  );
  try {
    const hit = await resolveInputAddress({
      value: destinationAddress,
      scope: "evm",
      isDirectAddress: (value) => {
        const checked = checkDestinationForAsset(chain, value);
        return checked.ok ? checked.address : null;
      },
    });
    const rechecked = checkDestinationForAsset(chain, hit.address);
    if (!rechecked.ok) throw invalid();
    return {
      destination: rechecked,
      name: hit.name,
      resolvedAt: hit.resolvedAt,
    };
  } catch (error) {
    if (error instanceof NameInputError) {
      if (error.reason === "unregistered") {
        throw new Error(
          "That name is not registered. Ask the user for the full destination address.",
        );
      }
      if (error.reason === "unavailable") {
        throw new Error("Name lookup is unavailable. Try again shortly.");
      }
      throw invalid();
    }
    throw error;
  }
}
