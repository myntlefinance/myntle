import type { Tool } from "ai";
import type { ToolContext, ToolDomain } from "./context";
import {
  createWalletBalancesTool,
  GET_WALLET_BALANCES_CAPABILITY,
} from "./portfolio/balances";
import {
  createTransactionHistoryTool,
  GET_TRANSACTION_HISTORY_CAPABILITY,
} from "./portfolio/history";
import { createQuoteTool, GET_QUOTE_CAPABILITY } from "./trading/quote";
import {
  createPrepareSwapTool,
  PREPARE_SWAP_CAPABILITY,
} from "./trading/swap";
import {
  createTransactionStatusTool,
  GET_TRANSACTION_STATUS_CAPABILITY,
} from "./trading/status";
import {
  createSupportedAssetsTool,
  GET_SUPPORTED_ASSETS_CAPABILITY,
} from "./assets/catalogue";
import type { Capability } from "./capability";

/**
 * Every registered tool's declaration, in the same order as `createTools`.
 * A tool without an entry here fails `capabilities.test.ts`, which is what
 * keeps the prompt from under-describing what the assistant can do.
 */
export const CAPABILITIES: Capability[] = [
  GET_WALLET_BALANCES_CAPABILITY,
  GET_TRANSACTION_HISTORY_CAPABILITY,
  GET_QUOTE_CAPABILITY,
  PREPARE_SWAP_CAPABILITY,
  GET_TRANSACTION_STATUS_CAPABILITY,
  GET_SUPPORTED_ASSETS_CAPABILITY,
];

export type ToolRegistryOptions = {
  domains?: ToolDomain[];
};

/**
 * Creates tools scoped by domain or user context.
 * As new tools (lending, staking, bridge) are added, register them in their
 * respective domains here to prevent model tool confusion.
 */
export function createTools(
  context?: ToolContext,
  options: ToolRegistryOptions = {},
) {
  const domains = options.domains ?? ["portfolio", "trading", "assets"];
  // The toolset is heterogeneous: each tool has its own input and output, so
  // it is typed as the union rather than as the first tool that was added.
  const toolset: Record<string, Tool> = {};

  if (domains.includes("portfolio")) {
    toolset.get_wallet_balances = createWalletBalancesTool(context);
    toolset.get_transaction_history = createTransactionHistoryTool(context);
  }

  if (domains.includes("trading")) {
    toolset.get_quote = createQuoteTool(context);
    toolset.prepare_swap = createPrepareSwapTool(context);
    toolset.get_transaction_status = createTransactionStatusTool(context);
  }

  if (domains.includes("assets")) {
    toolset.get_supported_assets = createSupportedAssetsTool(context);
  }

  return toolset;
}

export const tools = createTools();
