/**
 * The funding wallet abstraction.
 *
 * A funding connection is deliberately narrower than the application's wallet:
 * it may connect, read a balance, and send one deposit. It never signs an
 * intent, never proves identity, and never touches the app's session wallet.
 * The source of a deposit is therefore independent of the account that is
 * signed in.
 */

import { evmChainForSlug } from "../evm-chains";

export type FundingChainKind = "evm" | "solana" | "near";

/** The exact address, token, amount, and chain a wallet is funding. */
export type FundingDeposit = {
  address: string;
  /** Smallest-unit amount, from the deposit record rather than model text. */
  amountRaw: string;
  tokenContract?: string | null;
  chainId?: number | null;
  chainSlug?: string | null;
  chainName?: string | null;
  decimals: number;
  symbol: string;
};

export type FundingSendInput = FundingDeposit;

export type FundingSendResult = {
  txHash: string;
  senderAccount?: string;
};

export type FundingBalance = {
  tokenBalance: bigint | null;
  nativeBalance: bigint | null;
  enoughToken: boolean;
  enoughGas: boolean;
  /** One sentence naming the exact missing amount, when something is short. */
  shortfall?: string;
};

export type FundingCheck = FundingBalance & {
  /** The wallet is on a different chain than the deposit. */
  wrongNetwork?: boolean;
  currentChainId?: number | null;
};

export type FundingConnection = {
  kind: FundingChainKind;
  address: string;
  walletName?: string;
  walletIcon?: string;
  /** True when this connection is the app's already-connected wallet. */
  connected?: boolean;
  chainId?: number | null;
  check: (deposit: FundingDeposit) => Promise<FundingCheck>;
  send: (input: FundingSendInput) => Promise<FundingSendResult>;
  /** EVM wallets that cannot switch still show the state, without a Switch. */
  switchNetwork?: () => Promise<void>;
};

export type FundingState =
  | "choosing"
  | "connecting"
  | "checking"
  | "wrong-network"
  | "insufficient"
  | "ready"
  | "sending"
  | "error";

export function fundingChainKind(
  chainSlug: string | null | undefined,
): FundingChainKind | null {
  const slug = chainSlug?.toLowerCase() ?? null;
  if (!slug) return null;
  if (slug === "near") return "near";
  if (slug === "sol" || slug === "solana") return "solana";
  if (evmChainForSlug(slug)) return "evm";
  return null;
}

/** A raw token amount as a decimal string, with trailing zeroes trimmed. */
export function formatRawAmount(
  raw: bigint,
  decimals: number,
  maxFractionDigits = 6,
): string {
  if (decimals <= 0) return raw.toString();
  const negative = raw < 0n;
  const value = negative ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, "0");
  const trimmed = fraction.replace(/0+$/, "");
  const shown =
    trimmed.length > maxFractionDigits
      ? trimmed.slice(0, maxFractionDigits).replace(/0+$/, "")
      : trimmed;
  const text = shown.length > 0 ? `${whole}.${shown}` : whole.toString();
  return negative ? `-${text}` : text;
}

export function tokenShortfall(
  need: bigint,
  have: bigint,
  decimals: number,
  symbol: string,
): string {
  return `Need ${formatRawAmount(need, decimals)} ${symbol}, wallet has ${formatRawAmount(have, decimals)}`;
}

export function gasShortfall(
  need: bigint,
  have: bigint,
  decimals: number,
  symbol: string,
  includingAmount = false,
): string {
  return `Need about ${formatRawAmount(need, decimals, 4)} ${symbol} ${includingAmount ? "including gas" : "for gas"}, wallet has ${formatRawAmount(have, decimals, 4)} ${symbol}.`;
}

/** The dialog state a balance check maps to. */
export function fundingStateForCheck(check: FundingCheck): FundingState {
  if (check.wrongNetwork) return "wrong-network";
  return check.enoughToken && check.enoughGas ? "ready" : "insufficient";
}

/** Solana transaction fee and destination-account rent, in lamports. */
export const SOLANA_BASE_FEE = 5_000n;
export const SOLANA_TOKEN_ACCOUNT_RENT = 2_039_280n;

/**
 * The SOL a funding wallet must hold for one deposit.
 *
 * An SPL transfer creates the destination associated token account when the
 * one-time deposit address has none, and the sender pays that rent. Checking
 * only the sender's own ATA says "ready" on exactly the common fresh-address
 * case, so the destination is what this function requires.
 */
export function solanaGasNeed(input: {
  tokenTransfer: boolean;
  destinationAtaExists: boolean;
  amount: bigint;
}): bigint {
  if (!input.tokenTransfer) return input.amount + SOLANA_BASE_FEE;
  return (
    SOLANA_BASE_FEE +
    (input.destinationAtaExists ? 0n : SOLANA_TOKEN_ACCOUNT_RENT)
  );
}

/** Friendly copy for a wallet, RPC, or network refusal. */
export function friendlyFundingError(
  cause: unknown,
  networkName?: string | null,
): string {
  const raw = cause instanceof Error ? cause.message : "";
  if (raw === "unsupported-network") {
    return "This network is not supported by wallet funding yet.";
  }
  if (raw === "chain-switch-rejected") {
    return `Switch to ${networkName ?? "the deposit network"} in your wallet, then try again.`;
  }
  if (/reject|cancel|denied|dismiss/i.test(raw)) {
    return "The wallet request was rejected. Nothing was moved.";
  }
  if (/not connected|no account|did not share/i.test(raw)) {
    return "This wallet is not connected. Try again, or use the address.";
  }
  if (/not found|not detected|not installed|not available/i.test(raw)) {
    return "That wallet was not found in this browser. Use the address instead.";
  }
  if (/balance|rpc|network|fetch|timed out|timeout/i.test(raw)) {
    return "The wallet's balance could not be read. Try again, or use the address.";
  }
  return "The wallet could not send this deposit. Try again, or use the address.";
}

export function shortAddress(address: string): string {
  if (address.length <= 13) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export type FundingAction =
  | "Use QR"
  | "Switch"
  | "Try another"
  | "Send"
  | "Try again";

/**
 * The actions a state offers, in footer order.
 *
 * `Use QR` is present in every state except sending, which is the one moment
 * the wallet is mid-broadcast and the dialog cannot be dismissed.
 */
export function fundingActionsForState(
  state: FundingState,
  canSwitch: boolean,
): FundingAction[] {
  if (state === "sending") return [];
  const actions: FundingAction[] = ["Use QR"];
  if (state === "wrong-network" && canSwitch) actions.push("Switch");
  if (state === "insufficient") actions.push("Try another");
  if (state === "ready") actions.push("Send");
  if (state === "error") actions.push("Try again");
  return actions;
}
