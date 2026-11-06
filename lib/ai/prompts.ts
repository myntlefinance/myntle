import { buildSystemPrompt } from "./prompts/builder";

export * from "./prompts/identity";
export * from "./prompts/trading";
export * from "./prompts/portfolio";
export * from "./prompts/news";
export * from "./prompts/formatting";
export * from "./prompts/wallet";
export * from "./prompts/passkey";
export * from "./prompts/builder";

export const SYSTEM_INSTRUCTIONS = buildSystemPrompt();

export const TOOL_DESCRIPTIONS = {
  getWalletBalances:
    "Read the balances the connected account holds, valued with the current price list. Returns both the on-chain balance and the balance held inside the settlement ledger, because a trade can only spend the second one.",
  getSupportedAssets:
    "List the assets the connected account can actually trade, and which route each one supports.",
  getQuote:
    "Ask for a price. Returns the amount received, the minimum guaranteed amount, the rate, the fee, and when the quote expires.",
  getTransactionStatus:
    "Check the authoritative status of a trade that has already been submitted.",
  getTransactionHistory:
    "List the trades this account has already made.",
  getGoogleNews:
    "Search Google News. First call with query returns block 0 plus searchId and totalBlocks. Page with searchId + block.",
  getRedditPosts:
    "Search Reddit discussion. First call with query returns block 0 plus searchId and totalBlocks. Page with searchId + block.",
  getXPosts:
    "Search X posts. First call with query returns block 0 plus searchId and totalBlocks. Page with searchId + block; fresh page with searchId + nextPage.",
  getXUserPosts:
    "Fetch an X account's latest posts by handle. First call returns block 0 plus searchId and totalBlocks. Page with searchId + block; fresh page with searchId + nextPage.",
  getPageContent:
    "Read the full text of one page found by get_google_news, get_reddit_posts, or get_x_posts, only when snippets are insufficient.",
  prepareSwap:
    "Propose a trade for the user to approve. Returns the exact parameters that will be signed. Only call this once the user has agreed on a pair and an amount.",
  prepareDeposit:
    "Propose a deposit into the account so the interface can show the exact one-time address. Only call this when the balance is short or the user asks where to send funds; it acknowledges and moves nothing.",
} as const;
