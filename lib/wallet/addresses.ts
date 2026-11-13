import bs58 from "bs58";
import { normalizeEvmAddress } from "@/lib/intents/destination";
import { isNameResolutionError } from "@/lib/ports/names";
import type { NameChain, ResolvedName } from "@/lib/ports/names";

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

/**
 * Whether the input is an ENS name candidate on the EVM tab: anything that
 * is not a `0x` address and ends in `.eth`, case-insensitive.
 *
 * The 128-character input cap stays as-is for names. Realistic `.eth` names
 * are far shorter (registry labels run to 63 characters per label and full
 * names in the wild stay well under 64), so 128 already admits every name
 * a person would track while keeping the over-length guard. Bumping the cap
 * toward the 253-character DNS maximum would widen stored input for no
 * reachable user, so anything longer keeps the raw-path error instead.
 */
export function isEnsNameInput(chain: WatchChain, value: unknown): boolean {
  if (chain !== "evm" || typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_WATCH_ADDRESS_LENGTH) return false;
  if (trimmed.startsWith("0x") || trimmed.startsWith("0X")) return false;
  return trimmed.toLowerCase().endsWith(".eth");
}

/**
 * Whether the input is an SNS name candidate on the Solana tab: anything
 * ending in `.sns`, case-insensitive. The mirror of `isEnsNameInput` —
 * the same 128-character input cap admits every realistic `.sns` name,
 * and a raw base58 address can never match because `.` sits outside the
 * base58 alphabet.
 *
 * `*.sol` is deliberately not a candidate: the resolver holds `.sol` as
 * unavailable during the registry transition (the load-bearing `.sol`
 * rule in `lib/names/resolve.ts`), so a `.sol` input keeps the raw-path
 * error instead of reading as a name.
 */
export function isSnsNameInput(chain: WatchChain, value: unknown): boolean {
  if (chain !== "solana" || typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_WATCH_ADDRESS_LENGTH) return false;
  return trimmed.toLowerCase().endsWith(".sns");
}

/** The outcome of reading one watch input, raw or named. */
export type WatchInputResolution =
  | {
      ok: true;
      address: string;
      /** The normalized name when the input was one, else null. */
      name: string | null;
      /** Fresh ISO UTC from the read when the input was a name, else null. */
      resolvedAt: string | null;
    }
  | { ok: false; reason: "invalid" | "unregistered" | "unavailable" };

/**
 * Reads one watch input to its storable form. A raw address takes the
 * existing sync path untouched; a `.eth` candidate on EVM or a `.sns`
 * candidate on Solana resolves through the injected reader, which is the
 * debounced resolve route on the client and the name port on the server.
 * The reader is injected so this module stays free of provider coupling:
 * it never imports an adapter, an SDK client, or a key, and the boundary
 * test keeps biting if any arrives.
 *
 * Well-formed but unregistered reads as `unregistered` (never thrown);
 * anything the reader refuses with `invalid_input` reads as `invalid` and
 * every other failure reads as `unavailable`.
 */
export async function resolveWatchInput(
  chain: WatchChain,
  value: unknown,
  resolveName: (
    chain: NameChain,
    input: string,
  ) => Promise<ResolvedName | null>,
): Promise<WatchInputResolution> {
  const direct = normalizeWatchedAddress(chain, value);
  if (direct) {
    return { ok: true, address: direct, name: null, resolvedAt: null };
  }
  // The name branch, per chain: EVM reads `.eth`, Solana reads `.sns`.
  // Anything else (including `*.sol`, held unavailable at the resolver)
  // is not a name candidate and reads as invalid, exactly as before.
  const nameChain: NameChain | null =
    chain === "evm" && isEnsNameInput(chain, value)
      ? "evm"
      : chain === "solana" && isSnsNameInput(chain, value)
        ? "solana"
        : null;
  if (!nameChain) {
    return { ok: false, reason: "invalid" };
  }
  const raw = (value as string).trim();
  try {
    const hit = await resolveName(nameChain, raw);
    if (hit === null) return { ok: false, reason: "unregistered" };
    return {
      ok: true,
      address: hit.address,
      name: hit.name,
      resolvedAt: hit.resolvedAt,
    };
  } catch (error) {
    if (isNameResolutionError(error) && error.kind === "invalid_input") {
      return { ok: false, reason: "invalid" };
    }
    return { ok: false, reason: "unavailable" };
  }
}

/**
 * The inline reason the Track dialog shows when a name fails to read.
 * Each string reads as a complete sentence, in the existing
 * `watchAddressError` voice.
 */
export function watchNameError(
  reason: "invalid" | "unregistered" | "unavailable",
): string {
  if (reason === "unregistered") {
    return "That name is not registered. Check the spelling and try again.";
  }
  if (reason === "unavailable") {
    return "Name lookup is unavailable. Try again shortly.";
  }
  return "That name is not valid. Check it and try again.";
}
