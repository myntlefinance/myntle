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
Use this address as the default recipient when calling get_quote and prepare_swap unless the user specifies a different recipient.`;
  }

  return `Connected wallet: None (no wallet connected).`;
}
