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
