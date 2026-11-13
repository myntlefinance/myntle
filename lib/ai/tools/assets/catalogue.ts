import { tool } from "ai";
import { z } from "zod";
import { getAssets } from "@/lib/intents/service";
import { getLivePrices } from "@/lib/prices/server";
import { catalogueChain } from "@/lib/wallet/balances";
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
      "ticker can be a different contract on a different chain. The asset id is for " +
      "internal use in tool calls only and must never be read to the user; name the " +
      "ticker and its chain instead. Ticker strings never reach a signature.",
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
      let heldAssetIds: Set<string> | null = null;
      let heldContractChains: Set<string> | null = null;
      let heldPairs: Set<string> | null = null;
      let heldNativeNear = false;
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
        heldAssetIds = new Set();
        heldContractChains = new Set();
        heldPairs = new Set();
        for (const b of held.balances) {
          if (b.assetId) heldAssetIds.add(b.assetId);
          const assetChain = catalogueChain(b.network || b.chain);
          const contract = b.contractAddress?.trim().toLowerCase();
          if (contract) {
            // A contract is only an identity together with its chain: Base
            // and Optimism share the WETH predeploy.
            heldContractChains.add(`${contract}|${assetChain}`);
          }
          heldPairs.add(`${b.symbol.toLowerCase()}|${assetChain}`);
          // 1Click calls native NEAR wNEAR; a native NEAR holding has no
          // contract and would otherwise miss the catalogue row.
          if (
            !contract &&
            b.symbol.toLowerCase() === "near" &&
            assetChain === "near"
          ) {
            heldNativeNear = true;
          }
        }
      }

      const matchesHeld = (a: (typeof assets)[number]): boolean => {
        if (!heldAssetIds || !heldContractChains || !heldPairs) return true;
        // The balance layer already resolved the exact asset: trust it.
        if (heldAssetIds.has(a.assetId)) return true;
        const assetChain = catalogueChain(a.chain);
        const contract = a.contractAddress?.trim().toLowerCase();
        if (contract && heldContractChains.has(`${contract}|${assetChain}`)) {
          return true;
        }
        if (heldPairs.has(`${a.symbol.toLowerCase()}|${assetChain}`)) {
          return true;
        }
        return (
          heldNativeNear &&
          assetChain === "near" &&
          a.symbol.toLowerCase() === "wnear"
        );
      };

      const wanted = symbol?.trim().toLowerCase() || null;
      const matchesSymbol = (a: (typeof assets)[number]): boolean => {
        if (!wanted) return true;
        const actual = a.symbol.toLowerCase();
        if (actual === wanted) return true;
        // 1Click lists native NEAR as wNEAR on the near chain. A user asking
        // for NEAR means that row, not a bridged NEAR token on another chain.
        return (
          wanted === "near" &&
          actual === "wnear" &&
          catalogueChain(a.chain) === "near"
        );
      };

      const filtered = assets.filter((a) => matchesSymbol(a) && matchesHeld(a));

      // The catalogue price is a five-minute batch. Ask the live feed for
      // the first page the model will see, and keep the catalogue as the
      // fallback when the Worker is slow or down.
      const listed = filtered.slice(0, 60);
      const live = await getLivePrices(listed.map((a) => a.assetId));

      return {
        assets: listed.map((a) => {
          const quote = live.get(a.assetId);
          const priceAsOf = quote?.asOf ?? a.priceUpdatedAt;
          return {
            assetId: a.assetId,
            symbol: a.symbol,
            chain: a.chain,
            decimals: a.decimals,
            priceUsd: quote?.usd ?? a.price,
            ...(priceAsOf !== undefined ? { priceAsOf } : {}),
          };
        }),
      };
    },
  });
}

export const getSupportedAssets = createSupportedAssetsTool();
