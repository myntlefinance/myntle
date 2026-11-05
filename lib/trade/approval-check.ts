/**
 * Whether a browser approval claim matches the server-saved dry preview.
 *
 * Pure field equality, no dependencies, so the approve route and the tests
 * share the exact comparison. Every priced field must be byte-identical:
 * the wet quote is minted from the stored parameters, so anything the
 * client moved fails here before money is touched. The refund default
 * (connected wallet) is resolved by the caller before comparing.
 */
export type ApprovalClaim = {
  fromAssetId: string;
  toAssetId: string;
  amount: string;
  recipient: string;
  refundTo: string;
  slippageBps: number;
  minAmountOut: string;
  expiresAt: string;
};

export type StoredQuote = {
  fromAssetId: string;
  toAssetId: string;
  amount: string;
  recipient: string;
  refundTo: string;
  slippageBps: number;
  minAmountOutRaw: string;
  expiresAt: string;
};

export function isApprovalClaimMatchingQuote(
  claim: ApprovalClaim,
  stored: StoredQuote,
): boolean {
  return (
    claim.fromAssetId === stored.fromAssetId &&
    claim.toAssetId === stored.toAssetId &&
    claim.amount === stored.amount &&
    claim.recipient === stored.recipient &&
    claim.refundTo === stored.refundTo &&
    claim.slippageBps === stored.slippageBps &&
    claim.minAmountOut === stored.minAmountOutRaw &&
    claim.expiresAt === stored.expiresAt
  );
}
