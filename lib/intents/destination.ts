/**
 * The external destination of a confidential withdrawal.
 *
 * B4b measured that `DESTINATION_CHAIN` is a string-grammar switch, not an
 * existence check: `INTENTS` and `CONFIDENTIAL_INTENTS` happily accept a
 * lowercased EVM address and park the funds at an Intents account id, while
 * `DESTINATION_CHAIN` pays the chain address. The application therefore never
 * exposes the type; it derives the type from the asset's destination chain
 * and normalises the address with viem before it is priced or stored.
 *
 * Only EVM destinations were measured. A destination asset on another chain
 * is refused with a plain reason rather than guessed at.
 */

import { getAddress, isAddress } from "viem";
import { evmChainForSlug } from "@/lib/wallet/evm-chains";

/**
 * Normalises an EIP-55 address to its checksummed form.
 *
 * `isAddress` accepts the checksummed and the all-lowercase form and rejects
 * a mixed-case address with a wrong checksum, which is exactly the grammar
 * 1Click measured. `getAddress` then produces the one display form the quote,
 * the record, and the card all use.
 */
export function normalizeEvmAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 120) return null;
  if (!isAddress(trimmed, { strict: true })) return null;
  try {
    return getAddress(trimmed);
  } catch {
    return null;
  }
}

export type DestinationCheck =
  | { ok: true; address: string; chain: string }
  | {
      ok: false;
      reason: "unknown-chain" | "unsupported-chain" | "invalid-address";
    };

/**
 * Validates a destination against the chain the destination asset lives on.
 *
 * The chain slug comes from the 1Click catalogue, so this is the same source
 * that prices the route. An unknown slug, a non-EVM chain, and a malformed
 * address are distinct outcomes so the caller can say something true.
 */
export function checkDestinationForAsset(
  chain: string | null | undefined,
  value: unknown,
): DestinationCheck {
  if (!chain) return { ok: false, reason: "unknown-chain" };
  if (!evmChainForSlug(chain)) return { ok: false, reason: "unsupported-chain" };
  const address = normalizeEvmAddress(value);
  if (!address) return { ok: false, reason: "invalid-address" };
  return { ok: true, address, chain };
}
