/**
 * Name resolution behind `NameResolverPort`. Callers use `resolveName`
 * (or a resolver built with `createNameResolver`) and never import an
 * adapter or SDK directly — ENS travels through the evm-rpc adapter and
 * SNS through the proxy reader in `lib/adapters/solana-rpc/`.
 *
 * Contract (frozen in step 01, ported in `lib/ports/names.ts`):
 * - Success returns `{ address, name, resolvedAt }`; `name` echoes the
 *   normalized input and `resolvedAt` is always fresh ISO UTC.
 * - Well-formed but unregistered returns `null` (never throws).
 * - Anything else unresolvable throws `NameResolutionError`. The
 *   catch-mapping below is written out explicitly: `nameError()` is a
 *   factory, not a converter.
 * - Load-bearing `.sol` rule: any `*.sol` input throws `unavailable`
 *   with `sns_sol_transition` — never `invalid_input`, never `null`.
 *   Step 08 owns the re-enable flip.
 *
 * Freshness: the default `resolveName` reads fresh on every call
 * (money-path TTL 0). Pass a `NameCache` to share one request-scoped
 * memo across a chat turn; failures are never stored.
 */

import { normalize } from "viem/ens";
import type {
  EvmRpcPort,
  NameChain,
  NameResolutionError,
  NameResolverPort,
  ResolvedName,
} from "@/lib/ports";
import {
  InvalidInput,
  NotFound,
  ProviderNotConfigured,
  ProviderUnavailable,
  nameError,
} from "@/lib/ports";
import { alchemyEvmRpcPort } from "@/lib/adapters/alchemy/evm-rpc";
import { resolveSnsAddress } from "@/lib/adapters/solana-rpc/sns";
import type { SnsResolution } from "@/lib/adapters/solana-rpc/sns";
import { NameCache } from "./cache";

const LOOKUP_UNAVAILABLE = "Name lookup is unavailable. Try again shortly.";
const BAD_NAME = "That name is not valid. Check it and try again.";

function normalizeEvmName(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw nameError(
      "invalid_input",
      "bad_name",
      "That name is empty. Enter a name and try again.",
    );
  }
  const lowered = trimmed.toLowerCase();
  if (!lowered.endsWith(".eth")) {
    throw nameError(
      "invalid_input",
      "bad_suffix",
      "Only .eth names resolve here. Check the ending and try again.",
    );
  }
  try {
    return normalize(lowered);
  } catch {
    throw nameError("invalid_input", "bad_name", BAD_NAME);
  }
}

const SOLANA_LABEL = /^[a-z0-9-]{1,63}$/;

function normalizeSolanaName(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw nameError(
      "invalid_input",
      "bad_name",
      "That name is empty. Enter a name and try again.",
    );
  }
  const lowered = trimmed.toLowerCase();
  if (lowered.endsWith(".sol")) {
    throw nameError(
      "unavailable",
      "sns_sol_transition",
      ".sol names cannot be read right now. Try again later.",
    );
  }
  if (!lowered.endsWith(".sns")) {
    throw nameError(
      "invalid_input",
      "bad_suffix",
      "Only .sns names resolve here. Check the ending and try again.",
    );
  }
  const labelsValid =
    lowered.length <= 253 &&
    lowered.split(".").every((label) => SOLANA_LABEL.test(label));
  if (!labelsValid) {
    throw nameError("invalid_input", "bad_name", BAD_NAME);
  }
  return lowered;
}

/**
 * A missing key is final until someone configures it, so it stays
 * non-retryable: kind `unavailable` with `retryable` false, built
 * explicitly because the factory defaults `unavailable` to retryable.
 */
function missingKey(reason: "ens_rpc" | "sns_proxy", error: ProviderNotConfigured): NameResolutionError {
  console.error(`[names] name read missing configuration: ${error.provider}`);
  return { kind: "unavailable", reason, message: LOOKUP_UNAVAILABLE, retryable: false };
}

function mapEnsError(error: unknown): NameResolutionError {
  if (error instanceof ProviderNotConfigured) {
    return missingKey("ens_rpc", error);
  }
  if (!(error instanceof ProviderUnavailable)) {
    console.error(
      `[names] unexpected evm read failure: ${error instanceof Error ? error.message : "unknown failure"}`,
    );
  }
  return nameError("unavailable", "ens_rpc", LOOKUP_UNAVAILABLE);
}

function mapSnsError(error: unknown): NameResolutionError {
  if (error instanceof ProviderNotConfigured) {
    return missingKey("sns_proxy", error);
  }
  if (error instanceof InvalidInput) {
    return nameError("invalid_input", "bad_name", BAD_NAME);
  }
  if (!(error instanceof ProviderUnavailable)) {
    console.error(
      `[names] unexpected solana read failure: ${error instanceof Error ? error.message : "unknown failure"}`,
    );
  }
  return nameError("unavailable", "sns_proxy", LOOKUP_UNAVAILABLE);
}

export type NameResolverDeps = {
  evmRpc?: EvmRpcPort;
  snsResolve?: (name: string) => Promise<SnsResolution>;
  /** Request-scoped memo. Absent means every call reads fresh (TTL 0). */
  cache?: NameCache | null;
};

export function createNameResolver(deps?: NameResolverDeps): NameResolverPort {
  const evmRpc = deps?.evmRpc ?? alchemyEvmRpcPort;
  const snsResolve = deps?.snsResolve ?? resolveSnsAddress;
  const cache = deps?.cache ?? null;
  return {
    async resolveName(chain: NameChain, input: string): Promise<ResolvedName | null> {
      if (chain === "evm") {
        const name = normalizeEvmName(input);
        if (cache) {
          const cached = cache.get(chain, name);
          if (cached.hit) return cached.value;
        }
        let address: `0x${string}` | null;
        try {
          address = await evmRpc.getEnsAddress(name);
        } catch (error) {
          throw mapEnsError(error);
        }
        if (address === null) {
          cache?.set(chain, name, null);
          return null;
        }
        const resolved: ResolvedName = {
          address,
          name,
          resolvedAt: new Date().toISOString(),
        };
        cache?.set(chain, name, resolved);
        return resolved;
      }
      const name = normalizeSolanaName(input);
      if (cache) {
        const cached = cache.get(chain, name);
        if (cached.hit) return cached.value;
      }
      try {
        const hit = await snsResolve(name);
        const resolved: ResolvedName = {
          address: hit.address,
          name,
          resolvedAt: new Date().toISOString(),
        };
        cache?.set(chain, name, resolved);
        return resolved;
      } catch (error) {
        if (error instanceof NotFound) {
          cache?.set(chain, name, null);
          return null;
        }
        throw mapSnsError(error);
      }
    },
  };
}

/**
 * Default entry point: fresh reads, no shared memory. Long-lived
 * freshness lives in the database (`resolved_at`), never here.
 */
export function resolveName(
  chain: NameChain,
  input: string,
): Promise<ResolvedName | null> {
  return createNameResolver().resolveName(chain, input);
}

/** Port-shaped handle for the registry (wired in step 05). */
export const nameResolverPort: NameResolverPort = {
  resolveName: (chain, input) => resolveName(chain, input),
};
