import { tool } from "ai";
import { z } from "zod";
import { getAssets, type Asset } from "@/lib/intents/service";

/**
 * The tools the assistant can reach.
 *
 * Five of them read. One proposes. None of them sign, and none of them
 * return an address, so the model never touches the wallet.
 */

export async function readBalances(accountId: string) {
  const assets = await getAssets();

  // The settlement ledger is what a trade can actually spend. The on-chain
  // balance is the user's own wallet, and is reported separately so the two
  // are never confused.
  return {
    accountId,
    assets: assets
      .filter((a) => a.chain === "near" || a.chain === "eth" || a.chain === "sol")
      .slice(0, 40)
      .map((a) => ({
        assetId: a.assetId,
        symbol: a.symbol,
        chain: a.chain,
        decimals: a.decimals,
        price: a.price,
      })),
  };
}

export const getWalletBalances = tool({
  description:
    "List the assets that are available to trade, with their chain, their decimals, " +
    "and their current price. This is the catalogue of tradeable assets, not the " +
    "user's personal balances, which are shown separately in the interface.",
  inputSchema: z.object({}),
  execute: async () => {
    const assets = await getAssets();
    // Only the major assets per chain. The full catalogue is 205 entries and
    // would take the model too long to read and summarise.
    const major = ["near", "eth", "sol", "arb", "base"];
    const seen = new Set<string>();
    const picked: Array<{ assetId: string; symbol: string; chain: string }> = [];
    for (const chain of major) {
      const chainAssets = assets
        .filter((a) => a.chain === chain)
        .sort((a, b) => b.price - a.price)
        .slice(0, 4);
      for (const a of chainAssets) {
        if (!seen.has(a.assetId)) {
          seen.add(a.assetId);
          picked.push({ assetId: a.assetId, symbol: a.symbol, chain: a.chain });
        }
      }
    }
    return { assets: picked };
  },
});

export const getSupportedAssets = tool({
  description:
    "List the assets that can be traded, with their chain, their decimals, and their " +
    "current price. Use this to turn a ticker into a full asset id, because the same " +
    "ticker can be a different contract on a different chain.",
  inputSchema: z.object({
    symbol: z
      .string()
      .optional()
      .describe("Ticker to look for, such as USDC or NEAR. Leave empty for everything."),
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
    amount: z.string().describe("Amount in the smallest unit of the token being sold"),
    recipient: z.string().describe("The account that receives the output"),
    slippageBps: z.number().int().min(1).max(300).default(100),
  }),
  execute: async ({ fromAssetId, toAssetId, amount, recipient, slippageBps }) => {
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
    depositAddress: z.string().describe("The deposit address the trade was given"),
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
    // The history endpoint needs a user session, which is not wired yet.
    // Returning an honest empty result beats inventing trades.
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
    amount: z.string().describe("Amount in the smallest unit of the token being sold"),
    recipient: z.string().describe("The account that receives the output"),
    slippageBps: z.number().int().min(1).max(300).default(100),
  }),
  // No execute function. The tool waits for the user to approve it.
});

export const tools = {
  get_wallet_balances: getWalletBalances,
  get_supported_assets: getSupportedAssets,
  get_quote: getQuote,
  get_transaction_status: getTransactionStatus,
  get_transaction_history: getTransactionHistory,
  prepare_swap: prepareSwap,
};
