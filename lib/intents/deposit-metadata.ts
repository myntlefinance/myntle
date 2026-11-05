/**
 * The metadata a deposit address carries.
 *
 * A minted address is only half of what a reader needs: to scan a QR or fund
 * it from a wallet, the card also needs the token contract, its chain, the
 * raw amount, and the deadline the quote gave the address. The deposit route
 * writes these next to the address in the transaction record, so a reload can
 * rebuild the same panel without asking 1Click again.
 *
 * Nothing here reads a secret. It is the same fields the route already priced.
 */

import { evmChainForSlug } from "@/lib/wallet/evm-chains";

export type DepositMetadata = {
  address?: string | null;
  memo?: string | null;
  expiresAt?: string | null;
  /** Smallest-unit amount the address was quoted for. */
  amountInRaw?: string | null;
  tokenContract?: string | null;
  /** EVM chain id, when the origin chain is an EVM chain. */
  chainId?: number | null;
  /** Human name, when the origin chain is one the app knows. */
  chainName?: string | null;
  /** 1Click's short chain slug, for example `arb`. */
  chainSlug?: string | null;
  decimals?: number | null;
  symbol?: string | null;
};

/** The wallet a deposit can be funded from, or nothing when none matches. */
export type DepositWalletKind = "evm" | "solana" | "near";

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

/**
 * Reads the deposit part of a transaction record.
 *
 * Only a `confidential-external` record is a deposit. A swap also has a
 * one-time address, and painting it as a deposit panel would tell the reader
 * to fund a trade that was never priced as one.
 */
export function readDepositMetadata(
  refs: Record<string, unknown> | null | undefined,
  fallbackAddress?: string | null,
): DepositMetadata | null {
  if (!refs || refs.mode !== "confidential-external") return null;
  const address = text(refs.depositAddress) ?? text(fallbackAddress);
  if (!address) return null;
  return {
    address,
    memo: text(refs.depositMemo),
    expiresAt: text(refs.expiresAt),
    amountInRaw: text(refs.amountInRaw),
    tokenContract: text(refs.tokenContract),
    chainId: integer(refs.chainId),
    chainName: text(refs.chainName),
    chainSlug: text(refs.chainSlug),
    decimals: integer(refs.decimals),
    symbol: text(refs.symbol),
  };
}

/** The human network name, never the raw slug when the app knows better. */
export function depositNetworkLabel(
  meta: DepositMetadata | null | undefined,
  fallbackSlug?: string | null,
): string | null {
  if (meta?.chainName) return meta.chainName;
  const slug = meta?.chainSlug ?? fallbackSlug ?? null;
  if (!slug) return null;
  const evm = evmChainForSlug(slug);
  if (evm) return evm.name;
  const normalized = slug.toLowerCase();
  if (normalized === "near") return "NEAR";
  if (normalized === "sol" || normalized === "solana") return "Solana";
  return slug.toUpperCase();
}

/** The short network name for a compact detail row. */
export function depositNetworkShortLabel(
  meta: DepositMetadata | null | undefined,
  fallbackSlug?: string | null,
): string | null {
  return depositNetworkLabel(meta, fallbackSlug)?.replace(/ One$/, "") ?? null;
}

/**
 * Which connected wallet could fund this address.
 *
 * A Solana wallet cannot pay an Arbitrum deposit, so the card hides its
 * Transfer action instead of offering a transfer the quote cannot receive.
 * Unknown chains have no compatible wallet and keep the QR only.
 */
export function depositWalletKind(
  meta: DepositMetadata | null | undefined,
): DepositWalletKind | null {
  const slug = meta?.chainSlug?.toLowerCase() ?? null;
  if (!slug) return null;
  if (evmChainForSlug(slug)) return meta?.chainId ? "evm" : null;
  if (slug === "near") return "near";
  if (slug === "sol" || slug === "solana") return "solana";
  return null;
}

/** True when this address can be funded from the connected wallet. */
export function canTransferDeposit(
  meta: DepositMetadata | null | undefined,
  walletKind: DepositWalletKind | null | undefined,
): meta is DepositMetadata & {
  amountInRaw: string;
  chainId: number | null;
} {
  const required = depositWalletKind(meta);
  if (!meta || !walletKind || required !== walletKind) return false;
  if (!meta.amountInRaw || !/^\d+$/.test(meta.amountInRaw)) return false;
  // An EVM transfer needs the chain id so `sendDeposit` can switch networks
  // before it sends. A native EVM asset has no contract; an ERC-20 does.
  if (required === "evm") return Number.isInteger(meta.chainId);
  return !!meta.tokenContract;
}
