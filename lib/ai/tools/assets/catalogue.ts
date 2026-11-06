import { tool } from "ai";
import { z } from "zod";
import { getAssets } from "@/lib/intents/service";
import type { ToolContext } from "../context";
import type { Capability } from "../capability";

export const GET_SUPPORTED_ASSETS_CAPABILITY: Capability = {
  tool: "get_supported_assets",
  tier: "read-public",
  subject: "none",
  approval: "none",
  attribution: "none",
  promptTerms: ["get_supported_assets"],
};

export function createSupportedAssetsTool(context?: ToolContext) {
  return tool({
    description:
      "List the assets that can be traded, with their chain, their decimals, and their " +
      "current price. Use this to turn a ticker into a full asset id, because the same " +
      "ticker can be a different contract on a different chain. Every entry carries " +
      "its full contract address; ticker strings never reach a signature.",
    inputSchema: z.object({
      symbol: z
        .string()
        .optional()
        .describe(
          "Ticker to look for, such as USDC or NEAR. Leave empty for everything.",
        ),
      heldOnly: z
        .boolean()
        .optional()
        .describe(
          "When true, return only assets the connected wallet actually holds. " +
          "Defaults to false. Requires a connected wallet.",
        ),
    }),
    execute: async ({ symbol, heldOnly }) => {
      const assets = await getAssets();

      // Narrow the catalogue to what the connected account holds, so the
      // model proposes routes that can actually be funded. Runs only on
      // request: the balance scan costs live chain reads.
      let heldContracts: Set<string> | null = null;
      let heldPairs: Set<string> | null = null;
      if (heldOnly) {
        const address = context?.activeAddress;
        const chain = context?.activeChain;
        if (!address || !chain) {
          return {
            assets: [],
            note: "No wallet is connected, so no held assets can be listed.",
          };
        }
        const { getConnectedWalletBalances } = await import(
          "@/lib/wallet/balances"
        );
        const held = await getConnectedWalletBalances(chain, address);
        // Balance networks read "eth", "base", "arb", "solana", "near";
        // the 1Click catalogue reads "eth", "base", "arb", "sol", "near".
        const chainAlias: Record<string, string> = {
          ethereum: "eth",
          arbitrum: "arb",
          optimism: "op",
          solana: "sol",
        };
        heldContracts = new Set();
        heldPairs = new Set();
        for (const b of held.balances) {
          if (b.contractAddress) {
            heldContracts.add(b.contractAddress.toLowerCase());
          }
          const net = (b.network || b.chain || "").toLowerCase();
          heldPairs.add(
            `${b.symbol.toLowerCase()}|${chainAlias[net] ?? net}`,
          );
        }
      }

      const matchesHeld = (a: (typeof assets)[number]): boolean => {
        if (!heldContracts || !heldPairs) return true;
        if (
          a.contractAddress &&
          heldContracts.has(a.contractAddress.toLowerCase())
        ) {
          return true;
        }
        return heldPairs.has(
          `${a.symbol.toLowerCase()}|${a.chain.toLowerCase()}`,
        );
      };

      const filtered = assets.filter(
        (a) =>
          (!symbol || a.symbol.toLowerCase() === symbol.toLowerCase()) &&
          matchesHeld(a),
      );

      return {
        assets: filtered.slice(0, 60).map((a) => ({
          assetId: a.assetId,
          symbol: a.symbol,
          chain: a.chain,
          contractAddress: a.contractAddress,
          decimals: a.decimals,
          priceUsd: a.price,
        })),
      };
    },
  });
}

export const getSupportedAssets = createSupportedAssetsTool();
