import type { ChainKind } from "./types";

/* ─────────────────────────────────────────────────────────
 * ADDRESS EXPLORERS
 * The public page an address lives on, per chain family. EVM
 * addresses share one multichain view on Blockscan; NEAR and
 * Solana each have their own explorer. Kept beside the wallet
 * types so the address row and its dialog never disagree.
 * ───────────────────────────────────────────────────────── */

const ADDRESS_EXPLORERS: Record<ChainKind, (address: string) => string> = {
  evm: (address) => `https://blockscan.com/address/${address}`,
  near: (address) => `https://nearblocks.io/address/${address}`,
  solana: (address) => `https://solscan.io/account/${address}`,
};

export function addressExplorerUrl(
  chain: ChainKind,
  address: string,
): string {
  return ADDRESS_EXPLORERS[chain](address.trim());
}
