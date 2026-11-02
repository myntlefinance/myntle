import { tool } from "ai";
import { z } from "zod";
import {
  getConnectedWalletBalances,
  groupBalancesByNetwork,
  isPhishingToken,
  type SupportedNetwork,
  type AssetCategory,
  type TokenBalance,
} from "@/lib/wallet/balances";
import { getIntentsLedgerBalances } from "@/lib/intents/balances";
import {
  SupportedNetworkEnum,
  SupportedChainEnum,
  type ToolContext,
} from "../context";
import type { Capability } from "../capability";

export const GET_WALLET_BALANCES_CAPABILITY: Capability = {
  tool: "get_wallet_balances",
  tier: "read-public",
  subject: "any-address",
  approval: "none",
  attribution: "required",
  promptTerms: ["get_wallet_balances", "any public address"],
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
          source: "none" as const,
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

      const showFilters = !singleNetwork && (!category || category === "all");
      const initialFilter = category && category !== "all" ? category : "all";
      const totalCombinedUsd =
        (walletRes.totalValueUsd ?? 0) + (intentsRes?.totalValueUsd ?? 0);

      const groups = groupBalancesByNetwork(allBalances);

      return {
        // `session` means the connected wallet; `requested` means the model
        // passed an address. The distinction stops a card from being read as
        // the user's own holdings when it is someone else's.
        source: address ? "requested" : "session",
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
