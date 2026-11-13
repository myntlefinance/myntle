import { tool } from "ai";
import { z } from "zod";
import type { QuoteMode } from "@/lib/intents/service";
import type { ToolContext } from "../context";
import type { Capability } from "../capability";
import { normalizeWatchedAddress } from "@/lib/wallet/addresses";
import { normalizeEvmAddress } from "@/lib/intents/destination";

export const GET_QUOTE_CAPABILITY: Capability = {
  tool: "get_quote",
  tier: "read-public",
  subject: "none",
  approval: "none",
  attribution: "none",
  promptTerms: ["get_quote"],
};

/**
 * Where the trade's input comes from.
 *
 * The Near Account is the default for every signed-in account. The connected
 * wallet is an explicit choice, because it can only spend and deliver on its
 * own chain. A logged-out preview has no account and prices from the wallet.
 */
export type QuoteFunding = "account" | "wallet";

/**
 * The product requests privacy on every quote. This is an application
 * constant, never a model choice: there is no public toggle.
 */
const QUOTE_CONFIDENTIALITY = "basic" as const;

export function createQuoteTool(context?: ToolContext) {
  const accountKind = context?.accountKind ?? "wallet";

  return tool({
    description:
      "Ask for a price on a trade. Returns the amount received, the minimum amount that " +
      "is guaranteed, the rate, and when the quote expires. Use this before proposing a " +
      "trade, and pass the figures through unchanged. A recipient or refund may be a name " +
      "such as vitalik.eth or example.sns; pass it through unchanged. " +
      (accountKind === "passkey"
        ? "This account trades from its Near Account balance, so leave funding at its default."
        : "Leave funding at its default to spend the Near Account balance. Set funding " +
          "to wallet only when the user explicitly asks to spend from the connected " +
          "wallet; the wallet route can only deliver an output on the wallet's own chain."),
    inputSchema: z.object({
      fromAssetId: z.string().describe("Full asset id of the token being sold"),
      toAssetId: z.string().describe("Full asset id of the token being bought"),
      amount: z
        .string()
        .describe("Amount in the smallest unit of the token being sold"),
      funding: z
        .enum(["account", "wallet"])
        .optional()
        .describe(
          "Where the input comes from. Defaults to the Near Account for a signed-in " +
            "account, because it can hold any asset on any chain. Set wallet only when " +
            "the user explicitly asks to spend from the connected wallet. A passkey " +
            "account has no wallet, so wallet funding is not available to it.",
        ),
      recipient: z
        .string()
        .optional()
        .describe(
          "The account that receives the output. Ignored for an account-funded quote, " +
            "which pays the account itself. For a wallet-funded quote it defaults to " +
            "the connected wallet address.",
        ),
      slippageBps: z.number().int().min(1).max(300).default(100),
      refundTo: z
        .string()
        .optional()
        .describe(
          "The account refunds return to on the origin chain. Ignored for an " +
            "account-funded quote, which refunds to the account itself. For a " +
            "wallet-funded quote it defaults to the connected wallet address.",
        ),
    }),
    execute: async ({
      fromAssetId,
      toAssetId,
      amount,
      funding,
      recipient,
      slippageBps,
      refundTo,
    }) => {
      const sessionAccountId = context?.intentsAccountId?.trim() || null;

      // The Near Account is the default source, not the connected wallet.
      // It can hold any asset on any chain, so it is the only route that
      // works for every destination the user can ask about. Spending from
      // the wallet is an explicit choice: that route can only deliver on
      // the wallet's own chain. A logged-out preview has no session account,
      // but the Intents account id is derived from the wallet key, so it can
      // still price the account route that wallet would use after signing in.
      const hasAccount = accountKind === "passkey" || sessionAccountId !== null;
      const requestedFunding: QuoteFunding =
        funding ?? (hasAccount ? "account" : "wallet");

      if (requestedFunding === "wallet" && accountKind === "passkey") {
        throw new Error(
          "This account has no wallet. Price the trade from the Near Account instead.",
        );
      }

      if (fromAssetId === toAssetId) {
        throw new Error(
          "The two assets are the same. Pick two different asset ids before pricing.",
        );
      }

      // A wallet-funded quote spends from the wallet's own chain. The quote
      // service validates the deposit and refund against the origin chain, so
      // a route whose origin lives elsewhere fails there with an opaque
      // message. Read the pair's chains from the same catalogue the quote
      // uses, before choosing the recipient, and recognise the impossible
      // route here with a reason the model can act on.
      let fromChain: string | null = null;
      let fromSymbol: string | null = null;
      let toChain: string | null = null;
      let toSymbol: string | null = null;
      if (requestedFunding === "wallet") {
        try {
          const { getAssets } = await import("@/lib/intents/service");
          const assets = await getAssets();
          const fromAsset = assets.find((asset) => asset.assetId === fromAssetId);
          const toAsset = assets.find((asset) => asset.assetId === toAssetId);
          fromChain = fromAsset?.chain ?? null;
          fromSymbol = fromAsset?.symbol ?? null;
          toChain = toAsset?.chain ?? null;
          toSymbol = toAsset?.symbol ?? null;
        } catch {
          // The catalogue is advisory here. A lookup failure must not turn a
          // valid quote into an error, and an unknown chain skips the guard.
        }
      }

      const walletChain = context?.activeChain?.trim().toLowerCase() || null;
      let walletRouteError: string | null = null;
      if (requestedFunding === "wallet" && walletChain && (fromChain || toChain)) {
        const { evmChainForSlug } = await import("@/lib/wallet/evm-chains");
        const chainLabel = (chain: string): string => {
          if (chain === "evm") return "EVM";
          if (chain === "sol") return "Solana";
          if (chain === "near") return "NEAR";
          return evmChainForSlug(chain)?.name ?? chain;
        };
        const walletLabel = chainLabel(walletChain);
        const onWalletChain = (chain: string): boolean =>
          walletChain === "evm"
            ? evmChainForSlug(chain) !== null
            : walletChain === "solana"
              ? chain === "sol"
              : walletChain === "near"
                ? chain === "near"
                : false;

        // The wallet's own address is only a delivery address on its own
        // chain family. A route that pays another chain needs a recipient
        // there, or the account route, which the wallet controls through
        // its Intents account id.
        const walletAddress = context?.activeAddress?.trim() || null;
        const suppliedRecipient = recipient?.trim() || null;
        const normalizedRecipient = normalizeEvmAddress(suppliedRecipient);
        const normalizedWallet = normalizeEvmAddress(walletAddress);
        const usesWalletRecipient =
          !suppliedRecipient ||
          suppliedRecipient === walletAddress ||
          (normalizedRecipient !== null &&
            normalizedRecipient === normalizedWallet);

        if (fromChain && !onWalletChain(fromChain)) {
          walletRouteError =
            `${fromSymbol ?? "That asset"} on ${chainLabel(fromChain)} cannot be funded from this ${walletLabel} wallet. ` +
            "Use the same token on the wallet's chain, or trade from the Near Account.";
        } else if (toChain && usesWalletRecipient && !onWalletChain(toChain)) {
          walletRouteError =
            `${toSymbol ?? "The output"} pays out on ${chainLabel(toChain)}, and this ${walletLabel} wallet cannot receive it there. ` +
            "Trade from the Near Account instead.";
        }
      }

      let accountFunded = requestedFunding === "account";
      let accountIdForQuote = sessionAccountId;

      // A logged-out preview has no session account, but the Intents account
      // id is deterministic from the connected key. Derive it once, so the
      // preview prices the same account route the wallet controls after
      // signing in and stores nothing because there is no user to key the row
      // to. A signed-in wallet keeps its session id and never derives here.
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

      // A signed-in wallet has a session account to fall back on, so the model
      // re-quotes with funding "account" instead of silently changing the
      // source. A logged-out preview cannot retry into a session, so it takes
      // the derived account for the same reason.
      if (requestedFunding === "wallet" && walletRouteError !== null) {
        if (!context?.userId && accountIdForQuote) {
          accountFunded = true;
        } else {
          throw new Error(walletRouteError);
        }
      }

      if (accountFunded && !accountIdForQuote) {
        throw new Error(
          "The account is not available. Sign in again before pricing a trade.",
        );
      }

      // An account-funded quote belongs to the account, not to an address the
      // model supplied: the output and any refund land back in the same
      // private balance the trade spends from.
      const targetRecipientConst = accountFunded
        ? accountIdForQuote
        : recipient || context?.activeAddress;
      if (!targetRecipientConst) {
        throw new Error(
          "No recipient specified and no connected wallet address found.",
        );
      }

      // Refunds must be valid on the origin chain, which the recipient
      // is not guaranteed to be. Default to the connected wallet.
      const targetRefundToConst = accountFunded
        ? accountIdForQuote
        : refundTo || context?.activeAddress || targetRecipientConst;
      if (!targetRefundToConst) {
        throw new Error("No refund address is available for this trade.");
      }

      // A recipient or refund may be a name. Each resolves server-side to
      // the address the quote binds, and the stored preview keeps the name
      // so approval can re-resolve it fresh. An account-funded quote skips
      // this entirely: it pays the account itself.
      let targetRecipient = targetRecipientConst;
      let targetRefundTo = targetRefundToConst;
      let recipientName: string | null = null;
      let recipientResolvedAt: string | null = null;
      let refundToName: string | null = null;
      let refundToResolvedAt: string | null = null;
      if (!accountFunded) {
        const { isNameLikeValue } = await import("@/lib/names/detect");
        if (recipient && isNameLikeValue(recipient)) {
          const hit = await resolveModelAddress(recipient);
          targetRecipient = hit.address;
          recipientName = hit.name;
          recipientResolvedAt = hit.resolvedAt;
          if (!refundTo) targetRefundTo = hit.address;
        }
        if (refundTo && isNameLikeValue(refundTo)) {
          const hit = await resolveModelAddress(refundTo);
          targetRefundTo = hit.address;
          refundToName = hit.name;
          refundToResolvedAt = hit.resolvedAt;
        }
      }

      // The wallet signs these exact strings. Canonicalise EVM addresses to
      // EIP-55 once here, after any name resolution, so the stored quote and
      // the signed message agree byte for byte.
      if (!accountFunded) {
        targetRecipient =
          normalizeEvmAddress(targetRecipient) ?? targetRecipient;
        // The refund returns on the origin chain, and checksumming is an EVM
        // rule. On a NEAR origin 1Click reads the mixed-case form as a
        // different, invalid account id. Normalise only when the catalogue
        // says the origin is an EVM chain; an unknown chain keeps the old
        // behaviour rather than guessing.
        const { evmChainForSlug } = await import("@/lib/wallet/evm-chains");
        if (fromChain === null || evmChainForSlug(fromChain)) {
          targetRefundTo =
            normalizeEvmAddress(targetRefundTo) ?? targetRefundTo;
        }
      }

      const mode: QuoteMode = accountFunded ? "confidential-intents" : "chain";

      const { quote } = await import("@/lib/intents/service");
      const q = await quote({
        fromAssetId,
        toAssetId,
        amount,
        recipient: targetRecipient,
        refundTo: targetRefundTo,
        slippageBps,
        confidentiality: QUOTE_CONFIDENTIALITY,
        mode,
      });

      // The dry preview is the server's record of what was priced. The
      // approval card carries its id, and the intent routes treat the stored
      // row as truth — browser figures that moved fail the comparison.
      // Logged-out previews still price; they just cannot be approved,
      // because approval requires the session the row is keyed to.
      let quoteId: string | null = null;
      const userId = context?.userId?.trim() || null;
      if (userId) {
        try {
          const { createQuote } = await import("@/lib/db/transactions");
          quoteId = await createQuote({
            userId,
            request: {
              fromAssetId,
              toAssetId,
              amount,
              recipient: targetRecipient,
              refundTo: targetRefundTo,
              slippageBps,
              confidentiality: QUOTE_CONFIDENTIALITY,
              // The mode and the account kind are stored so an approval
              // cannot re-purpose this quote for another route or account.
              mode,
              accountKind,
              intentsAccountId: accountIdForQuote,
              // The names the addresses resolved from, when names were
              // passed. Approval re-resolves them fresh: a name can be
              // re-pointed between pricing and approval.
              ...(recipientName
                ? { recipientName, recipientResolvedAt }
                : {}),
              ...(refundToName ? { refundToName, refundToResolvedAt } : {}),
            },
            response: {
              amountIn: q.amountIn,
              amountOut: q.amountOut,
              minAmountOutRaw: q.minAmountOutRaw,
              expiresAt: q.expiresAt,
            },
            expiresAt: q.expiresAt,
          });
        } catch {
          // A lost preview never blocks pricing; approval re-quotes live.
        }
      }

      return {
        engine: q.engine,
        // The route is the neutral public name for what funds the trade.
        // The stored row keeps the internal mode, never this output.
        route: accountFunded ? ("account" as const) : ("wallet" as const),
        quoteId,
        amountIn: q.amountInFormatted,
        amountInRaw: q.amountIn,
        amountOut: q.amountOutFormatted,
        amountOutRaw: q.amountOut,
        minAmountOut: q.minAmountOut,
        minAmountOutRaw: q.minAmountOutRaw,
        rate: q.rate,
        feeBps: q.feeBps,
        amountOutUsd: q.amountOutUsd,
        expiresAt: q.expiresAt,
      };
    },
  });
}

export const getQuote = createQuoteTool();

/**
 * Binds one model-supplied recipient or refund to its address. Direct EVM
 * and Solana addresses pass through; a name resolves fresh; anything else
 * stays raw for the quote endpoint to refuse, exactly as before. Errors
 * keep the tool voice: unregistered asks for the address, a lookup failure
 * asks for a retry.
 */
async function resolveModelAddress(value: string): Promise<{
  address: string;
  name: string | null;
  resolvedAt: string | null;
}> {
  const { NameInputError, resolveInputAddress } = await import(
    "@/lib/names/binding"
  );
  try {
    return await resolveInputAddress({
      value,
      scope: null,
      isDirectAddress: (trimmed) =>
        normalizeWatchedAddress("evm", trimmed) ??
        normalizeWatchedAddress("solana", trimmed),
    });
  } catch (error) {
    if (error instanceof NameInputError) {
      if (error.reason === "unregistered") {
        throw new Error(
          "That name is not registered. Ask the user for the full address.",
        );
      }
      if (error.reason === "unavailable") {
        throw new Error("Name lookup is unavailable. Try again shortly.");
      }
    }
    throw new Error(
      "That name is not valid. Ask the user for the full address.",
    );
  }
}
