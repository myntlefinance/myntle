/**
 * The kind of money movement a card proposes.
 *
 * Presentation-level intent from the assistant: what the user asked to do.
 * Execution settles every action through the same deposit-address path
 * until ledger-aware quoting lands; the label must never imply a
 * settlement mechanic the engine does not have yet.
 */

export const TRADE_ACTIONS = [
  "deposit",
  "swap",
  "bridge",
  "withdraw",
  "trade",
  "limit",
  "earn",
] as const;

export type TradeAction = (typeof TRADE_ACTIONS)[number];

export function parseTradeAction(value: unknown): TradeAction {
  if (value === "withdrawal") return "withdraw";
  return (TRADE_ACTIONS as readonly string[]).includes(value as string)
    ? (value as TradeAction)
    : "swap";
}

/** Card title: the action word alone. The legs below carry the figures. */
export function actionTitle(action: TradeAction): string {
  switch (action) {
    case "deposit":
      return "Deposit";
    case "bridge":
      return "Bridge";
    case "withdraw":
      return "Withdraw";
    case "trade":
      return "Trade";
    case "limit":
      return "Limit order";
    case "earn":
      return "Earn";
    case "swap":
      return "Swap";
  }
}

/**
 * The action named as a thing, for a sentence that reports on it.
 *
 * The action key cannot be interpolated as-is: `withdraw` is a verb, `limit`
 * is an order rather than a transaction, and `earn` is a deposit into a vault.
 * The record is exhaustive so a new action cannot ship without a sentence.
 */
export const ACTION_NOUN: Record<TradeAction, string> = {
  deposit: "deposit",
  swap: "swap",
  bridge: "bridge",
  withdraw: "withdrawal",
  trade: "trade",
  limit: "limit order",
  earn: "deposit",
};

/** Terminal card copy once the user refuses a proposal. */
export function rejectionSentence(action: TradeAction): string {
  return `You rejected the ${ACTION_NOUN[action]}.`;
}

/**
 * Terminal card copy once the action settles.
 *
 * The sentence says what finished, in the reader's own terms. It never names
 * the store the application read the outcome from, because the reader is not
 * deciding anything about a database.
 */
export function settledSentence(action: TradeAction): string {
  return action === "limit"
    ? "Your limit order filled."
    : `Your ${ACTION_NOUN[action]} is complete.`;
}

/** Terminal card copy once the action fails. */
export function failureSentence(action: TradeAction): string {
  return `Your ${ACTION_NOUN[action]} failed. Please try again.`;
}
