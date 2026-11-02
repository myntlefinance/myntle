import { buildSystemPrompt } from "./prompts/builder";

export * from "./prompts/identity";
export * from "./prompts/trading";
export * from "./prompts/portfolio";
export * from "./prompts/formatting";
export * from "./prompts/wallet";
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
  prepareSwap:
    "Propose a trade for the user to approve. Returns the exact parameters that will be signed. Only call this once the user has agreed on a pair and an amount.",
} as const;
