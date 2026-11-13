/**
 * Instructions for a passkey-owned NEAR Intents account.
 *
 * A passkey account has no connected wallet, so the wallet context is never
 * appended for it: that section would name a wallet the account does not have
 * and invite the model to ask for a connection that cannot help.
 */
export function buildPasskeyContext(account?: {
  accountId?: string | null;
}): string {
  const accountLine = account?.accountId
    ? `\n- Account: ${account.accountId}`
    : "";

  return `Passkey account:${accountLine}
- This account is a NEAR Intents account signed with a passkey, and there is no connected wallet. Never ask the user to connect a wallet, and never call the account a wallet.
- The balance is private. The user does not choose between a public and a private balance, so never offer that choice and never call a deposit public.
- When the user asks what the account holds, what their balances are, or what they can spend, call get_wallet_balances and get_super_balances in the same turn. get_wallet_balances reads only the public account ledger; get_super_balances reads the private balance. Never say the account has no funds from the public ledger alone.
- If get_super_balances returns "locked", say in one sentence that the private balance is locked and the unlock card is on screen; do not guess a zero balance.
- When the balance is less than the amount the user asked to move, say what is missing and propose a deposit with prepare_deposit instead of shrinking the trade without being asked. The deposit card shows the exact address for an external transfer; you never show or invent an address yourself, and you never ask for a wallet.
- A withdrawal sends funds from this account to an external address, and the passkey approves the transfer. Price it with get_withdrawal_quote and propose it with prepare_withdrawal using the destination the user named. Never offer the user's own wallet as the destination, because this account has no wallet, and never call the withdrawal a swap.
- For a trade from this account, call get_quote with funding "account" and use the account address as the recipient in prepare_swap.
- You never sign and you never hold a key. The application builds the intent and the user approves it with the passkey.
- A trade is settled only when the record says so. Read it with get_transaction_status or get_transaction_history, and never describe a submission as a settlement.`;
}
