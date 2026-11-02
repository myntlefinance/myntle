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

export function createSupportedAssetsTool(_context?: ToolContext) {
  return tool({
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
}

export const getSupportedAssets = createSupportedAssetsTool();
