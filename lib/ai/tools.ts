import { tool } from "ai";
import { z } from "zod";
import { getAssets } from "@/lib/intents/service";
import {
  getConnectedWalletBalances,
  groupBalancesByNetwork,
  isPhishingToken,
  type SupportedNetwork,
  type AssetCategory,
  type TokenBalance,
} from "@/lib/wallet/balances";
import { getIntentsLedgerBalances } from "@/lib/intents/balances";

export const SupportedNetworkEnum = z.enum([
  "arbitrum",
  "base",
  "ethereum",
  "optimism",
  "polygon",
  "solana",
  "near",
]);

export const SupportedChainEnum = z.enum(["evm", "solana", "near"]);

/**
 * Context passed to the tools from the active chat turn.
 */
export type ToolContext = {
  activeAddress?: string | null;
  activeChain?: string | null;
  authToken?: string | null;
};

/**
 * Reads token balances for an account.
 */
export async function readBalances(accountId: string, chain = "near") {
  return getConnectedWalletBalances(chain, accountId);
}

export function createWalletBalancesTool(context?: ToolContext) {
  return tool({
    description:
      "Read the user's token balances. Returns on-chain balances in their connected wallet " +
      "(EVM, Solana, or NEAR) and their NEAR Intents settlement ledger balance. " +
      "Use this whenever the user asks about their balances, portfolio, or what they have available to trade.",
    inputSchema: z.object({
      address: z
        .string()
        .optional()
        .describe(
          "The wallet address to check. Defaults to the connected wallet if omitted.",
        ),
      chain: SupportedChainEnum.optional().describe(
        "The blockchain network family (evm, solana, near). Defaults to the connected wallet chain.",
      ),
      networks: z
        .array(SupportedNetworkEnum)
        .optional()
        .describe(
          "Specific networks to query (e.g. ['arbitrum'], ['base', 'ethereum']). " +
          "When the user asks for a single network like 'my arbitrum balances', pass ['arbitrum'].",
        ),
      category: z
        .enum(["all", "stables", "dust", "native"])
        .optional()
        .describe(
          "Filter by asset category: 'stables' for stablecoins (USDC, USDT, USDS, AUSD, DAI), " +
          "'dust' for balances under $1, 'native' for gas tokens (ETH, SOL, NEAR).",
        ),
      symbol: z
        .string()
        .optional()
        .describe("Specific token symbol to filter by (e.g. 'USDC', 'ETH')."),
      includeZeroValue: z
        .boolean()
        .optional()
        .describe(
          "Whether to include zero-value or unpriced tokens. Defaults to false (hidden by default). " +
          "Only set to true if the user explicitly asks to see zero-value tokens, unpriced assets, or fresh airdrops.",
        ),
      includeSettlementLedger: z
        .boolean()
        .optional()
        .describe(
          "Whether to include the NEAR Intents settlement ledger. Defaults to false when specific non-NEAR networks are queried, or true for general portfolio queries.",
        ),
    }),
    execute: async ({
      address,
      chain,
      networks,
      category,
      symbol,
      includeZeroValue,
      includeSettlementLedger,
    }) => {
      const targetAddress = address || context?.activeAddress;
      const targetChain = chain || context?.activeChain;

      if (!targetAddress || !targetChain) {
        return {
          connected: false,
          message:
            "No wallet is connected. Please connect a wallet to view balances.",
        };
      }

      const shouldIncludeLedger =
        includeSettlementLedger ??
        (networks && networks.length > 0 && !networks.includes("near")
          ? false
          : true);

      const [walletRes, intentsRes] = await Promise.all([
        getConnectedWalletBalances(targetChain, targetAddress, {
          networks: networks as SupportedNetwork[] | undefined,
          category: category as AssetCategory | undefined,
          symbol,
          includeZeroValue,
        }),
        shouldIncludeLedger
          ? getIntentsLedgerBalances(
              targetAddress,
              context?.authToken ?? undefined,
            )
          : Promise.resolve(null),
      ]);

      const allBalances: TokenBalance[] = [...walletRes.balances];
      if (intentsRes?.balances) {
        const allowZero = Boolean(includeZeroValue || symbol);
        for (const b of intentsRes.balances) {
          if (isPhishingToken(b.symbol, b.symbol)) continue;
          if (!allowZero && (!b.valueUsd || b.valueUsd <= 0)) continue;

          allBalances.push({
            chain: "near",
            network: "intents",
            symbol: b.symbol,
            name: b.symbol,
            contractAddress: b.assetId,
            decimals: b.decimals,
            balance: b.balance,
            rawBalance: b.rawBalance,
            priceUsd: b.priceUsd,
            valueUsd: b.valueUsd,
          });
        }
      }

      const singleNetwork =
        networks && networks.length === 1 ? networks[0] : null;

      let suggestedTitle = "Portfolio balances";
      if (singleNetwork) {
        suggestedTitle = `${singleNetwork.charAt(0).toUpperCase() + singleNetwork.slice(1)} balances`;
      } else if (category === "stables") {
        suggestedTitle = "Stablecoin balances";
      } else if (category === "dust") {
        suggestedTitle = "Dust balances";
      } else if (targetChain === "evm" && (!networks || networks.length > 1)) {
        suggestedTitle = "EVM balances";
      }

      // If user specifically asked for one network (like Arbitrum) or a specific category (like Stables),
      // we disable the filter bar since they are already focused on that view.
      const showFilters = !singleNetwork && (!category || category === "all");
      const initialFilter = category && category !== "all" ? category : "all";
      const totalCombinedUsd =
        (walletRes.totalValueUsd ?? 0) + (intentsRes?.totalValueUsd ?? 0);

      const groups = groupBalancesByNetwork(allBalances);

      return {
        connected: true,
        address: targetAddress,
        chain: targetChain,
        title: suggestedTitle,
        showFilters,
        initialFilter,
        singleNetwork,
        category: category ?? "all",
        totalValueUsd: Number.parseFloat(totalCombinedUsd.toFixed(2)),
        groups,
        wallet: {
          balances: walletRes.balances.slice(0, 30),
          totalValueUsd: walletRes.totalValueUsd,
          error: walletRes.error,
        },
        settlementLedger: intentsRes
          ? {
              balances: intentsRes.balances,
              totalValueUsd: intentsRes.totalValueUsd,
              status: intentsRes.status,
              message: intentsRes.message,
            }
          : null,
      };
    },
  });
}

export const getWalletBalances = createWalletBalancesTool();

export const getSupportedAssets = tool({
  description:
    "List the assets that can be traded, with their chain, their decimals, and their " +
    "current price. Use this to turn a ticker into a full asset id, because the same " +
    "ticker can be a different contract on a different chain.",
  inputSchema: z.object({
    symbol: z
      .string()
      .optional()
      .describe(
        "Ticker to look for, such as USDC or NEAR. Leave empty for everything.",
      ),
  }),
  execute: async ({ symbol }) => {
    const assets = await getAssets();
    const filtered = symbol
      ? assets.filter((a) => a.symbol.toLowerCase() === symbol.toLowerCase())
      : assets;

    return {
      assets: filtered.slice(0, 60).map((a) => ({
        assetId: a.assetId,
        symbol: a.symbol,
        chain: a.chain,
        decimals: a.decimals,
        priceUsd: a.price,
      })),
    };
  },
});

export const getQuote = tool({
  description:
    "Ask for a price on a trade. Returns the amount received, the minimum amount that " +
    "is guaranteed, the rate, and when the quote expires. Use this before proposing a " +
    "trade, and pass the figures through unchanged.",
  inputSchema: z.object({
    fromAssetId: z.string().describe("Full asset id of the token being sold"),
    toAssetId: z.string().describe("Full asset id of the token being bought"),
    amount: z
      .string()
      .describe("Amount in the smallest unit of the token being sold"),
    recipient: z.string().describe("The account that receives the output"),
    slippageBps: z.number().int().min(1).max(300).default(100),
  }),
  execute: async ({ fromAssetId, toAssetId, amount, recipient, slippageBps }) => {
    if (fromAssetId === toAssetId) {
      throw new Error(
        "The two assets are the same. Pick two different asset ids before pricing.",
      );
    }
    const { quote } = await import("@/lib/intents/service");
    const q = await quote({
      fromAssetId,
      toAssetId,
      amount,
      recipient,
      slippageBps,
    });

    return {
      engine: q.engine,
      amountIn: q.amountInFormatted,
      amountOut: q.amountOutFormatted,
      minAmountOut: q.minAmountOut,
      minAmountOutRaw: q.minAmountOutRaw,
      rate: q.rate,
      amountOutUsd: q.amountOutUsd,
      expiresAt: q.expiresAt,
    };
  },
});

export const getTransactionStatus = tool({
  description:
    "Check the authoritative status of a trade that has already been submitted. " +
    "Returns whether it settled, is still processing, was refunded, or failed.",
  inputSchema: z.object({
    depositAddress: z
      .string()
      .describe("The deposit address the trade was given"),
  }),
  execute: async ({ depositAddress }) => {
    const { getStatus } = await import("@/lib/intents/service");
    const status = await getStatus(depositAddress);
    return {
      state: status.state,
      amountOut: status.amountOut,
      explorerUrls: status.explorerUrls,
    };
  },
});

export const getTransactionHistory = tool({
  description: "List the trades this account has already made.",
  inputSchema: z.object({}),
  execute: async () => {
    return { trades: [], note: "History is not available yet." };
  },
});

export const prepareSwap = tool({
  description:
    "Propose a trade for the user to approve. Returns the exact parameters that will " +
    "be signed, and waits for the user's decision. Call this only after the user has " +
    "agreed on a pair and an amount, and only with figures that came from get_quote.",
  inputSchema: z.object({
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

export function createTools(context?: ToolContext) {
  return {
    get_wallet_balances: createWalletBalancesTool(context),
    get_supported_assets: getSupportedAssets,
    get_quote: getQuote,
    get_transaction_status: getTransactionStatus,
    get_transaction_history: getTransactionHistory,
    prepare_swap: prepareSwap,
  };
}

export const tools = createTools();
