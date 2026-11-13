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
import {
  createGoogleNewsTool,
  GET_GOOGLE_NEWS_CAPABILITY,
} from "./news/google-news";
import {
  createRedditPostsTool,
  GET_REDDIT_POSTS_CAPABILITY,
} from "./news/reddit-posts";
import {
  createXPostsTool,
  GET_X_POSTS_CAPABILITY,
} from "./news/x-posts";
import {
  createXUserPostsTool,
  GET_X_USER_POSTS_CAPABILITY,
} from "./news/x-user-posts";
import {
  createRequestSuperUnlockTool,
  REQUEST_SUPER_UNLOCK_CAPABILITY,
} from "./intents/unlock";
import {
  createSuperBalancesTool,
  GET_SUPER_BALANCES_CAPABILITY,
} from "./intents/balances";
import {
  createPrepareDepositTool,
  PREPARE_DEPOSIT_CAPABILITY,
} from "./intents/deposit";
import {
  createGetWithdrawalQuoteTool,
  GET_WITHDRAWAL_QUOTE_CAPABILITY,
} from "./intents/withdraw-quote";
import {
  createPrepareWithdrawalTool,
  PREPARE_WITHDRAWAL_CAPABILITY,
} from "./intents/withdraw";
import {
  createEarnOptionsTool,
  GET_EARN_OPTIONS_CAPABILITY,
} from "./earn/options";
import {
  createLimitOrderQuoteTool,
  GET_LIMIT_ORDER_QUOTE_CAPABILITY,
} from "./orders/quote";
import {
  createPrepareLimitOrderTool,
  PREPARE_LIMIT_ORDER_CAPABILITY,
} from "./orders/prepare";
import {
  createGetLimitOrdersTool,
  GET_LIMIT_ORDERS_CAPABILITY,
} from "./orders/list";
import {
  createPageContentTool,
  GET_PAGE_CONTENT_CAPABILITY,
} from "./news/page-content";
import {
  createResolveEnsNameTool,
  createResolveSnsNameTool,
  RESOLVE_ENS_NAME_CAPABILITY,
  RESOLVE_SNS_NAME_CAPABILITY,
} from "./names/resolve";
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
  GET_LIMIT_ORDER_QUOTE_CAPABILITY,
  PREPARE_LIMIT_ORDER_CAPABILITY,
  GET_LIMIT_ORDERS_CAPABILITY,
  PREPARE_DEPOSIT_CAPABILITY,
  GET_WITHDRAWAL_QUOTE_CAPABILITY,
  PREPARE_WITHDRAWAL_CAPABILITY,
  GET_TRANSACTION_STATUS_CAPABILITY,
  GET_SUPPORTED_ASSETS_CAPABILITY,
  GET_EARN_OPTIONS_CAPABILITY,
  GET_GOOGLE_NEWS_CAPABILITY,
  GET_REDDIT_POSTS_CAPABILITY,
  GET_X_POSTS_CAPABILITY,
  GET_X_USER_POSTS_CAPABILITY,
  GET_PAGE_CONTENT_CAPABILITY,
  REQUEST_SUPER_UNLOCK_CAPABILITY,
  GET_SUPER_BALANCES_CAPABILITY,
  RESOLVE_ENS_NAME_CAPABILITY,
  RESOLVE_SNS_NAME_CAPABILITY,
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
  const domains = options.domains ?? [
    "portfolio",
    "trading",
    "assets",
    "news",
    "intents",
    "names",
  ];
  // The toolset is heterogeneous: each tool has its own input and output, so
  // it is typed as the union rather than as the first tool that was added.
  const toolset: Record<string, Tool> = {};

  if (domains.includes("portfolio")) {
    toolset.get_wallet_balances = createWalletBalancesTool(context);
    toolset.get_transaction_history = createTransactionHistoryTool(context);
  }

  // A status question arrives through either route: "what happened to my
  // transaction" is a portfolio question, and "did my swap go through" is a
  // trade question. The same read answers both, so neither domain may scope
  // it out.
  if (domains.includes("portfolio") || domains.includes("trading")) {
    toolset.get_transaction_status = createTransactionStatusTool(context);
  }

  if (domains.includes("trading")) {
    toolset.get_quote = createQuoteTool(context);
    toolset.prepare_swap = createPrepareSwapTool();
    toolset.get_limit_order_quote = createLimitOrderQuoteTool(context);
    toolset.prepare_limit_order = createPrepareLimitOrderTool();
    toolset.get_limit_orders = createGetLimitOrdersTool(context);
    toolset.get_earn_options = createEarnOptionsTool();
  }

  if (domains.includes("assets")) {
    toolset.get_supported_assets = createSupportedAssetsTool(context);
  }

  if (domains.includes("news")) {
    toolset.get_google_news = createGoogleNewsTool();
    toolset.get_reddit_posts = createRedditPostsTool();
    toolset.get_x_posts = createXPostsTool();
    toolset.get_x_user_posts = createXUserPostsTool();
    toolset.get_page_content = createPageContentTool();
  }

  if (domains.includes("intents")) {
    toolset.prepare_deposit = createPrepareDepositTool();
    toolset.get_withdrawal_quote = createGetWithdrawalQuoteTool(context);
    toolset.prepare_withdrawal = createPrepareWithdrawalTool();
    toolset.get_super_balances = createSuperBalancesTool(context);
    toolset.request_super_unlock = createRequestSuperUnlockTool();
  }

  if (domains.includes("names")) {
    toolset.resolve_ens_name = createResolveEnsNameTool();
    toolset.resolve_sns_name = createResolveSnsNameTool();
  }

  return toolset;
}

export const tools = createTools();
