/**
 * The canonical trade approval message.
 *
 * Pure string building with no dependencies, so the card (client) and the
 * approve route (server) construct byte-identical messages. The wallet signs
 * this text; the server rebuilds it from validated parameters and requires
 * an exact match before verifying the signature. Amounts are raw
 * smallest-unit integers, which compare exactly, unlike formatted figures.
 */

export type TradeApprovalParams = {
  fromAssetId: string;
  toAssetId: string;
  /** Amount in the smallest unit of the token being sold. */
  amount: string;
  recipient: string;
  /** Account refunds return to on the origin chain. Bound so funds cannot be rerouted. */
  refundTo: string;
  slippageBps: number;
  /** Minimum accepted output, in the smallest unit of the token being bought. */
  minAmountOut: string;
  /** ISO timestamp of the quoted price expiry. */
  expiresAt: string;
  /** ISO timestamp of the approval request. Binds the signature to its window. */
  requestedAt: string;
};

/** How long an approval stays actionable after the card appears. */
export const APPROVAL_WINDOW_MS = 5 * 60_000;

/** Whether an approval request is still inside its window. */
export function isApprovalWindowValid(requestedAt: string, now = Date.now()): boolean {
  const at = Date.parse(requestedAt);
  if (Number.isNaN(at)) return false;
  const age = now - at;
  // A small future allowance covers client/server clock skew; anything older
  // than the window is expired.
  return age >= -60_000 && age <= APPROVAL_WINDOW_MS;
}

export function buildTradeApprovalMessage(p: TradeApprovalParams): string {
  return (
    `Approve trade on Myntle\n` +
    `\n` +
    `Send: ${p.amount} ${p.fromAssetId}\n` +
    `Receive at least: ${p.minAmountOut} ${p.toAssetId}\n` +
    `To: ${p.recipient}\n` +
    `Refund to: ${p.refundTo}\n` +
    `Slippage: ${p.slippageBps} bps\n` +
    `Quote expires: ${p.expiresAt}\n` +
    `Requested: ${p.requestedAt}`
  );
}
