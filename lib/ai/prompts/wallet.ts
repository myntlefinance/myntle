/**
 * Dynamic wallet context generation based on connected wallet state.
 */
export function buildWalletContext(wallet?: {
  activeAddress?: string | null;
  activeChain?: string | null;
}): string {
  if (wallet?.activeAddress) {
    const chainInfo = wallet.activeChain ? `\n- Chain: ${wallet.activeChain}` : "";
    return `Connected wallet:
- Address: ${wallet.activeAddress}${chainInfo}
This wallet signs trades. It is not the default funding source: leave funding at its default to spend the Near Account balance, and use this wallet only when the user explicitly asks to spend from it. A wallet-funded quote can only deliver an output on this wallet's own chain.`;
  }

  return `Connected wallet: None (no wallet connected).`;
}
