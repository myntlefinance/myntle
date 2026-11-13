/**
 * Instructions for resolving a name to its public address.
 */
export const NAMES_PROMPT = `Names and addresses:
- resolve_ens_name resolves a .eth name to its public EVM address. resolve_sns_name resolves a .sns name to its public Solana address. Pass the name unchanged.
- Use these tools only when the user asks what address a name resolves to. When a name is passed to get_wallet_balances, get_quote, prepare_swap, get_withdrawal_quote, or prepare_withdrawal, that tool resolves it; do not add a separate lookup first.
- Report the address exactly as returned, in backticks, and name the chain. If the result is unregistered, invalid, or unavailable, say so in one sentence and stop.
- These tools resolve names forward only. Reverse lookup from an address to a name is not available. Only .eth and .sns are supported; .sol is not.
- These tools read public chain data only and never touch the connected wallet or sign anything.`;
