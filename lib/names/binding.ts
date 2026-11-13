import {
  isNameResolutionError,
  type NameChain,
  type ResolvedName,
} from "@/lib/ports/names";
import { nameChainForInput } from "./detect";

/**
 * Server-side name binding for the money path.
 *
 * Server-only: the default resolver is loaded from the adapter registry on
 * first use, and the registry refuses to load in the browser. Client code
 * previews through `fetchNamePreview` in `./detect` instead.
 *
 * Freshness is TTL 0 throughout: every call resolves live and never accepts
 * a cached `resolvedAt`. Reads in tools resolve once at validation; the
 * approve routes resolve again at sign time because a name can be
 * re-pointed between pricing and approval.
 */

export type NameResolverFn = (
  chain: NameChain,
  input: string,
) => Promise<ResolvedName | null>;

async function defaultResolve(
  chain: NameChain,
  input: string,
): Promise<ResolvedName | null> {
  const { getNameResolverPort } = await import("@/lib/adapters/registry");
  return getNameResolverPort().resolveName(chain, input);
}

/** A model-supplied value that cannot bind to an address, with its kind. */
export class NameInputError extends Error {
  readonly reason: "invalid" | "unregistered" | "unavailable";
  constructor(reason: "invalid" | "unregistered" | "unavailable") {
    super(`name input ${reason}`);
    this.name = "NameInputError";
    this.reason = reason;
  }
}

export type ResolvedInput = {
  address: string;
  /** The normalized name when the input was one, else null. */
  name: string | null;
  /** Fresh ISO UTC from the read when the input was a name, else null. */
  resolvedAt: string | null;
};

/**
 * Binds one model-supplied value to its address.
 *
 * A direct address takes the caller's sync check untouched; a name resolves
 * fresh through the port; anything else throws `NameInputError`. The scope
 * pins which family the address must be usable on: a name on another family
 * (`.eth` where Solana is required) is invalid, exactly as a malformed
 * address is. A null scope lets the suffix decide, for inputs whose chain
 * is validated downstream.
 */
export async function resolveInputAddress(opts: {
  value: unknown;
  scope: NameChain | null;
  isDirectAddress: (trimmed: string) => string | null;
  resolve?: NameResolverFn;
}): Promise<ResolvedInput> {
  const trimmed =
    typeof opts.value === "string" ? opts.value.trim() : "";
  if (!trimmed) throw new NameInputError("invalid");
  const direct = opts.isDirectAddress(trimmed);
  if (direct) return { address: direct, name: null, resolvedAt: null };
  const chain = nameChainForInput(trimmed);
  if (!chain || (opts.scope && chain !== opts.scope)) {
    throw new NameInputError("invalid");
  }
  const resolve = opts.resolve ?? defaultResolve;
  let hit: ResolvedName | null;
  try {
    hit = await resolve(chain, trimmed);
  } catch (error) {
    if (isNameResolutionError(error) && error.kind === "invalid_input") {
      throw new NameInputError("invalid");
    }
    throw new NameInputError("unavailable");
  }
  if (hit === null) throw new NameInputError("unregistered");
  return { address: hit.address, name: hit.name, resolvedAt: hit.resolvedAt };
}

/** Address equality per chain family: EVM hex casing carries no meaning. */
export function sameResolvedAddress(
  chain: NameChain,
  a: string,
  b: string,
): boolean {
  if (chain === "evm") {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
  }
  return a.trim() === b.trim();
}

/**
 * Re-verifies a stored `{ name, address }` binding with a fresh read.
 * Approval and signing always take this path: a stored `resolvedAt` is
 * never accepted, because the name may have been re-pointed since.
 */
export async function reverifyNameBinding(opts: {
  chain: NameChain;
  name: string;
  address: string;
  resolve?: NameResolverFn;
}): Promise<
  | { ok: true }
  | {
      ok: false;
      reason: "mismatch" | "unregistered" | "unavailable" | "invalid";
    }
> {
  const resolve = opts.resolve ?? defaultResolve;
  let hit: ResolvedName | null;
  try {
    hit = await resolve(opts.chain, opts.name);
  } catch (error) {
    if (isNameResolutionError(error)) {
      return {
        ok: false,
        reason: error.kind === "invalid_input" ? "invalid" : "unavailable",
      };
    }
    return { ok: false, reason: "unavailable" };
  }
  if (hit === null) return { ok: false, reason: "unregistered" };
  if (!sameResolvedAddress(opts.chain, hit.address, opts.address)) {
    return { ok: false, reason: "mismatch" };
  }
  return { ok: true };
}
