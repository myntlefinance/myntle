import { z } from "zod";

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

export type ToolDomain = "portfolio" | "trading" | "assets";

/**
 * Context passed to the tools from the active chat turn.
 */
export type ToolContext = {
  activeAddress?: string | null;
  activeChain?: string | null;
  authToken?: string | null;
};
