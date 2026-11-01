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
  slippageBps: number;
  /** Minimum accepted output, in the smallest unit of the token being bought. */
  minAmountOut: string;
  /** ISO timestamp of the quoted price expiry. */
  expiresAt: string;
};

export function buildTradeApprovalMessage(p: TradeApprovalParams): string {
  return (
    `Approve trade on Myntle\n` +
    `\n` +
    `Send: ${p.amount} ${p.fromAssetId}\n` +
    `Receive at least: ${p.minAmountOut} ${p.toAssetId}\n` +
    `To: ${p.recipient}\n` +
    `Slippage: ${p.slippageBps} bps\n` +
    `Quote expires: ${p.expiresAt}`
  );
}
