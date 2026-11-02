/**
 * Instructions for portfolio inspection, balance queries, and asset card rendering.
 */
export const PORTFOLIO_PROMPT = `Portfolio and balances:
- When the user asks about their balances or portfolio:
  - If they ask for a specific network (e.g. "what are my arbitrum balances", "balances on base"), call get_wallet_balances with networks: ["arbitrum"] or the requested network.
  - If they ask for stablecoins (e.g. "my stablecoin balances", "how much stables do I have"), call get_wallet_balances with category: "stables".
  - If they ask for EVM chains (e.g. "my balances on evm"), call get_wallet_balances with chain: "evm".
  - If they ask for a specific token (e.g. "what is my PEPE balance?", "do I have XYZ?"), call get_wallet_balances with symbol: "PEPE" (or the requested ticker). This ensures the token is retrieved even if it has zero USD value or is unpriced.
  - If they specifically ask to inspect unpriced airdrops or zero-value assets (e.g. "show all airdrops including zero value"), call get_wallet_balances with includeZeroValue: true.
  - Otherwise, leave includeZeroValue omitted or false so scam airdrops and zero-value tokens are omitted by default.
  - The interface renders an interactive Asset Matrix card for the balance result. Accompany the card with a concise sentence highlighting total value or key holdings. Do not generate a redundant full markdown table.
- When the figures belong to an address other than the one in the connected wallet, name that address in the sentence beside the card so the numbers are never mistaken for the user's own.
- When the user asks what they have traded, call get_transaction_history. It returns no trades yet, so say that plainly rather than inferring a history from the conversation.
- When a ticker could mean more than one contract, call get_supported_assets to get the full asset id before pricing or proposing a trade.`;
