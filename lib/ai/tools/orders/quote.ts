import { tool } from "ai";
import { z } from "zod";
import type { Asset } from "@/lib/intents/service";
import type { LimitOrderAmounts } from "@/lib/intents/orders";
import type { ToolContext } from "../context";
import type { Capability } from "../capability";

export const GET_LIMIT_ORDER_QUOTE_CAPABILITY: Capability = {
  tool: "get_limit_order_quote",
  tier: "read-public",
  subject: "none",
  approval: "none",
  attribution: "none",
  promptTerms: ["get_limit_order_quote"],
};

/** How long the stored preview may be approved for. */
const QUOTE_TTL_MS = 15 * 60_000;

export type LimitOrderFunding = "account" | "wallet";

function chainLabel(chain: string, nameForSlug: (slug: string) => string | null): string {
  if (chain === "evm") return "EVM";
  if (chain === "sol") return "Solana";
  if (chain === "near") return "NEAR";
  return nameForSlug(chain) ?? chain;
}

export function createLimitOrderQuoteTool(context?: ToolContext) {
  const accountKind = context?.accountKind ?? "wallet";

  return tool({
    description:
      "Price a resting limit order. Returns the amount deposited, the amount received at " +
      "the limit price, the price, and the quote id that prepare_limit_order accepts. " +
      "A SELL deposits the base asset and receives the quote asset; a BUY deposits the " +
      "quote asset and receives the base asset. The quantity is in the base asset's " +
      "smallest unit, and the price is human units of quote per one base. Leave funding " +
      "at its default to spend the Near Account balance. Set funding to wallet only when " +
      "the user explicitly asks to spend from the connected wallet; that route can only " +
      "fund and pay out on the wallet's own chain. A passkey account has no wallet.",
    inputSchema: z.object({
      baseAssetId: z.string().min(1).describe("Full asset id of the base asset"),
      quoteAssetId: z.string().min(1).describe("Full asset id of the quote asset"),
      side: z
        .enum(["BUY", "SELL"])
        .describe("SELL spends the base asset; BUY spends the quote asset"),
      quantity: z
        .string()
        .regex(
          /^[1-9]\d*$/,
          "Quantity must be a positive whole number in the base asset's smallest unit",
        )
        .describe("Base-asset quantity in its smallest unit"),
      price: z
        .string()
        .regex(
          /^\d+(\.\d{1,18})?$/,
          "Price must be a positive decimal with at most 18 places",
        )
        .describe(
          "Human-unit limit price: quote asset units per one base asset",
        ),
      funding: z
        .enum(["account", "wallet"])
        .optional()
        .describe(
          "Where the input comes from. Defaults to the Near Account for a signed-in " +
            "account. Set wallet only when the user explicitly asks to spend from the " +
            "connected wallet. A passkey account has no wallet.",
        ),
    }),
    execute: async ({ baseAssetId, quoteAssetId, side, quantity, price, funding }) => {
      if (baseAssetId === quoteAssetId) {
        throw new Error(
          "The two assets are the same. Pick two different asset ids before pricing an order.",
        );
      }

      const { getAssets } = await import("@/lib/intents/service");
      let assets: Asset[];
      try {
        assets = await getAssets();
      } catch {
        throw new Error(
          "The asset catalogue is unavailable. Try again in a moment.",
        );
      }

      const baseAsset = assets.find((asset) => asset.assetId === baseAssetId);
      const quoteAsset = assets.find((asset) => asset.assetId === quoteAssetId);
      if (!baseAsset || !quoteAsset) {
        throw new Error(
          "That asset is not in the catalogue. Look it up with get_supported_assets first.",
        );
      }

      const sessionAccountId = context?.intentsAccountId?.trim() || null;
      const hasAccount = accountKind === "passkey" || sessionAccountId !== null;
      const requestedFunding: LimitOrderFunding =
        funding ?? (hasAccount ? "account" : "wallet");

      if (requestedFunding === "wallet" && accountKind === "passkey") {
        throw new Error(
          "This account has no wallet. Price the order from the Near Account instead.",
        );
      }

      // The quote tool may run for a logged-out preview. The Intents account
      // id is deterministic from the connected key, so the preview can price
      // the account route that wallet controls after signing in, while no row
      // is stored because there is no user to key it to.
      let accountIdForQuote = sessionAccountId;
      if (
        !accountIdForQuote &&
        !context?.userId &&
        context?.activeAddress &&
        context?.activeChain
      ) {
        const { intentsAccountId: deriveIntentsAccountId } = await import(
          "@/lib/intents/balances"
        );
        accountIdForQuote = deriveIntentsAccountId(
          context.activeChain,
          context.activeAddress,
        );
      }

      if (requestedFunding === "wallet") {
        const walletChain = context?.activeChain?.trim().toLowerCase() || null;
        const walletAddress = context?.activeAddress?.trim() || null;
        if (!walletChain || !walletAddress) {
          throw new Error(
            "No wallet is connected for a wallet-funded order. Place the order from the Near Account instead.",
          );
        }

        const { evmChainForSlug } = await import("@/lib/wallet/evm-chains");
        const labelFor = (chain: string): string =>
          chainLabel(chain, (slug) => evmChainForSlug(slug)?.name ?? null);
        const walletLabel = labelFor(walletChain);
        const onWalletChain = (chain: string): boolean =>
          walletChain === "evm"
            ? evmChainForSlug(chain) !== null
            : walletChain === "solana"
              ? chain === "sol"
              : walletChain === "near"
                ? chain === "near"
                : false;

        // A wallet-funded order deposits on the origin chain and pays the
        // wallet on its destination chain, so both sides must belong to the
        // wallet's own chain family. Anything else needs the account route,
        // which the wallet controls through its Intents account id.
        const inputAsset = side === "SELL" ? baseAsset : quoteAsset;
        const outputAsset = side === "SELL" ? quoteAsset : baseAsset;
        if (!onWalletChain(inputAsset.chain)) {
          throw new Error(
            `${inputAsset.symbol} on ${labelFor(inputAsset.chain)} cannot be funded from this ${walletLabel} wallet. ` +
              "Place the order from the Near Account instead.",
          );
        }
        if (!onWalletChain(outputAsset.chain)) {
          throw new Error(
            `${outputAsset.symbol} pays out on ${labelFor(outputAsset.chain)}, and this ${walletLabel} wallet cannot receive it there. ` +
              "Place the order from the Near Account instead.",
          );
        }
      }

      if (requestedFunding === "account" && !accountIdForQuote) {
        throw new Error(
          "The account is not available. Sign in again before pricing an order.",
        );
      }

      const { computeLimitOrderAmounts } = await import("@/lib/intents/orders");
      let amounts: LimitOrderAmounts;
      try {
        amounts = computeLimitOrderAmounts({
          side,
          quantity,
          price,
          baseAssetId,
          quoteAssetId,
          baseDecimals: baseAsset.decimals,
          quoteDecimals: quoteAsset.decimals,
        });
      } catch {
        throw new Error(
          "The order figures are not valid. Check the quantity and the price.",
        );
      }

      const { formatUnits } = await import("@/lib/intents/balances");
      const quantityFormatted = formatUnits(quantity, baseAsset.decimals);
      const totalRaw =
        side === "SELL" ? amounts.outputAmount : amounts.inputAmount;
      const totalFormatted = formatUnits(totalRaw, quoteAsset.decimals);

      const expiresAt = new Date(Date.now() + QUOTE_TTL_MS).toISOString();

      let quoteId: string | null = null;
      const userId = context?.userId?.trim() || null;
      if (userId && accountIdForQuote) {
        try {
          const { createQuote } = await import("@/lib/db/transactions");
          quoteId = await createQuote({
            userId,
            request: {
              kind: "limit_order",
              baseAssetId,
              quoteAssetId,
              side,
              quantity,
              price: price.trim(),
              funding: requestedFunding,
              accountKind,
              intentsAccountId: accountIdForQuote,
            },
            response: {
              kind: "limit_order",
              inputAssetId: amounts.inputAssetId,
              outputAssetId: amounts.outputAssetId,
              inputAmount: amounts.inputAmount,
              outputAmount: amounts.outputAmount,
              baseSymbol: baseAsset.symbol,
              quoteSymbol: quoteAsset.symbol,
              quantityFormatted,
              totalFormatted,
              price: price.trim(),
              deadline: expiresAt,
            },
            expiresAt,
          });
        } catch {
          // A lost preview never blocks pricing; prepare_limit_order carries
          // no quote id, and the create route refuses a missing row.
        }
      }

      return {
        quoteId,
        side,
        baseSymbol: baseAsset.symbol,
        quoteSymbol: quoteAsset.symbol,
        baseAssetId,
        quoteAssetId,
        inputAssetId: amounts.inputAssetId,
        outputAssetId: amounts.outputAssetId,
        inputAmount: amounts.inputAmount,
        outputAmount: amounts.outputAmount,
        quantityFormatted,
        totalFormatted,
        // The card keeps the raw figures beside the display strings: the
        // quantity is the base in its smallest unit and the total is the
        // quote-side amount in its own smallest unit.
        quantityRaw: quantity,
        totalRaw,
        price: price.trim(),
        funding: requestedFunding,
        route: requestedFunding,
        accountKind,
        expiresAt,
        ...(requestedFunding === "wallet"
          ? {
              note:
                "This order is funded by the connected wallet and pays it out on the same chain family.",
            }
          : {}),
      };
    },
  });
}

export const getLimitOrderQuote = createLimitOrderQuoteTool();
