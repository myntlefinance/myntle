import type { ChainKind, ConnectedWallet } from "@/lib/wallet/types";

/**
 * Identity helpers for the sentence card's address chips.
 *
 * Identity here is chain plus address: the same wallet on two chains is two
 * accounts, and different ecosystems never share an address format, so a
 * match is only ever claimed on an exact address plus a known chain family.
 * Unknown chains never match — a popup would rather under-claim YOU than
 * mislabel someone else's address.
 */

/** EVM-compatible chain ids, matching the catalogue and icon vocabularies. */
const EVM_CHAINS = new Set([
  "eth",
  "ethereum",
  "eth-mainnet",
  "arb",
  "arbitrum",
  "arb-mainnet",
  "base",
  "base-mainnet",
  "optimism",
  "op",
  "opt",
  "opt-mainnet",
  "polygon",
  "pol",
  "matic",
  "polygon-mainnet",
]);

const SOLANA_CHAINS = new Set(["sol", "solana", "solana-mainnet"]);
const NEAR_CHAINS = new Set(["near", "near-mainnet"]);

/** Wallet kind for a catalogue chain id, or null when it is not known. */
export function walletKindForChain(chain?: string): ChainKind | null {
  const norm = (chain || "").trim().toLowerCase();
  if (norm.length === 0) return null;
  if (SOLANA_CHAINS.has(norm)) return "solana";
  if (NEAR_CHAINS.has(norm)) return "near";
  if (EVM_CHAINS.has(norm)) return "evm";
  return null;
}

/**
 * Whether an account id already reads as a name. NEAR named accounts do;
 * EVM hex, implicit 64-hex, and base58 addresses do not. Unknown formats
 * shorten rather than risk showing noise.
 */
function isReadableAccountId(address: string): boolean {
  // Anything 0x-prefixed reads as an EVM-shaped id, whatever its length.
  if (address.toLowerCase().startsWith("0x")) return false;
  if (/^[0-9a-f]{64}$/i.test(address)) return false;
  return /^[a-z0-9._-]{2,64}$/.test(address);
}

/** Shortens a long address to head…tail; short ids pass through. */
export function shortAddr(addr: string): string {
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * What an address chip shows: the wallet app name for the connected
 * wallet, the full id when it already reads as a name, else the shortened
 * form. The full address always survives one hover away in the popup.
 */
export function addressLabel(
  account: ConnectedWallet | null | undefined,
  address: string,
): string {
  if (
    account?.walletName &&
    account.address.toLowerCase() === address.toLowerCase()
  ) {
    return account.walletName;
  }
  if (isReadableAccountId(address)) return address;
  return shortAddr(address);
}

/**
 * The full presentation identity for an address chip: what text shows,
 * which mark leads it, and whether it is the connected wallet. Label and
 * mark always agree — a chip never wears a brand it cannot prove.
 */
export function addressIdentity(
  account: ConnectedWallet | null | undefined,
  address: string,
  chain?: string,
): { address: string; label: string; icon?: string; isSelf: boolean } {
  const selfByAddress =
    !!account?.address &&
    !!address &&
    account.address.toLowerCase() === address.toLowerCase();
  return {
    address,
    label: addressLabel(account, address),
    icon: selfByAddress ? account?.walletIcon : undefined,
    isSelf: isSelfAddress(account, address, chain),
  };
}

/**
 * Whether an address on a chain is the connected wallet's own account.
 * Compares case-insensitively (EVM hex casing carries no meaning) and
 * requires the chain family to match the wallet kind.
 */
export function isSelfAddress(
  account: ConnectedWallet | null | undefined,
  address?: string,
  chain?: string,
): boolean {
  const mine = account?.address;
  if (!account || !mine || !address) return false;
  if (mine.toLowerCase() !== address.toLowerCase()) return false;
  const there = walletKindForChain(chain);
  return there !== null && there === account.kind;
}
