import bs58 from "bs58";
import { normalizeEvmAddress } from "@/lib/intents/destination";

/**
 * The shared watch-address validators.
 *
 * Both the Track dialog and the watchlist routes validate through these, so
 * a client can never talk the server into tracking a malformed address. EVM
 * goes through the existing viem strict normaliser (wrong-checksum mixed
 * case rejected, stored checksummed so one account is one row). Solana is a
 * base58 32-byte decode, re-encoded to its canonical form. NEAR is the
 * account-id grammar: a named account of 2–64 characters, or the 64-hex
 * implicit form, stored lowercase.
 */

export type WatchChain = "evm" | "solana" | "near";

export const WATCH_CHAINS: readonly WatchChain[] = [
  "evm",
  "solana",
  "near",
] as const;

/** Over-length input is rejected before any decode is attempted. */
export const MAX_WATCH_ADDRESS_LENGTH = 128;

/** A label is a short name, never a sentence. */
export const MAX_WATCH_LABEL_LENGTH = 24;

/** A watchlist holds at most five addresses. */
export const MAX_WATCHLIST_ENTRIES = 5;

// The named account-id grammar: dot-separated labels of lowercase alphanumerics
// with `-` and `_` inside, 2–64 characters overall.
const NEAR_NAMED_REGEX =
  /^(([a-z0-9]+[-_])*[a-z0-9]+\.)*([a-z0-9]+[-_])*[a-z0-9]+$/;
const NEAR_IMPLICIT_REGEX = /^[0-9a-f]{64}$/;

export function isWatchChain(value: unknown): value is WatchChain {
  return (
    value === "evm" || value === "solana" || value === "near"
  );
}

/**
 * Normalises a watched address for its chain, or null when malformed.
 * EVM returns checksummed, Solana canonical base58, NEAR lowercase.
 */
export function normalizeWatchedAddress(
  chain: WatchChain,
  value: unknown,
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_WATCH_ADDRESS_LENGTH) return null;

  if (chain === "evm") return normalizeEvmAddress(trimmed);

  if (chain === "solana") {
    let bytes: Uint8Array;
    try {
      bytes = bs58.decode(trimmed);
    } catch {
      return null;
    }
    if (bytes.length !== 32) return null;
    return bs58.encode(bytes);
  }

  const lower = trimmed.toLowerCase();
  if (NEAR_IMPLICIT_REGEX.test(lower)) return lower;
  if (lower.length < 2 || lower.length > 64) return null;
  return NEAR_NAMED_REGEX.test(lower) ? lower : null;
}

/** The short form a label falls back to when none is given. */
export function defaultWatchLabel(chain: WatchChain, address: string): string {
  if (
    chain === "near" &&
    !address.startsWith("0x") &&
    address.includes(".") &&
    address.length <= 18
  ) {
    return address;
  }
  if (address.startsWith("0x") && address.length >= 10) {
    return `${address.slice(0, 6)}…${address.slice(-4)}`;
  }
  if (address.length > 12) {
    return `${address.slice(0, 4)}…${address.slice(-4)}`;
  }
  return address;
}

/**
 * The label a row keeps: the trimmed name, or the truncated address when
 * none was given. Over-length labels are rejected, never silently cut.
 */
export function normalizeWatchLabel(
  label: unknown,
  chain: WatchChain,
  address: string,
): string | null {
  if (label === undefined || label === null) {
    return defaultWatchLabel(chain, address);
  }
  if (typeof label !== "string") return null;
  const trimmed = label.trim();
  if (!trimmed) return defaultWatchLabel(chain, address);
  if (trimmed.length > MAX_WATCH_LABEL_LENGTH) return null;
  return trimmed;
}

/**
 * The one inline reason the Track dialog shows per chain, or null when the
 * address is ready. Each string reads as a complete sentence.
 */
export function watchAddressError(
  chain: WatchChain,
  value: string,
): string | null {
  if (!value.trim()) return null;
  if (normalizeWatchedAddress(chain, value)) return null;
  if (chain === "evm") return "Enter a valid 0x address.";
  if (chain === "solana") return "Enter a valid Solana address.";
  return "Enter a valid NEAR account.";
}
