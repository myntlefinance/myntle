/**
 * Adapter registry: env-selected wiring behind the port signatures.
 * Server-side only — provider keys must never reach the browser.
 *
 * Selection follows one pattern per surface, each defaulting so that
 * production behavior is unchanged:
 * - `BALANCES_PROVIDER` (default `"alchemy"`)
 * - `EVM_RPC_PROVIDER` (default `"alchemy"`)
 * - `SOLANA_RPC_PROVIDER` (default `"endpoint"`)
 *
 * Every getter returns the real adapter. A missing key is still the typed
 * `ProviderNotConfigured`, enforced before any adapter code runs.
 *
 * Solana `?rpc=` rule (binding): a key-bearing endpoint is NEVER forwarded
 * in the query string. Only an explicitly configured non-key endpoint
 * (`SOLANA_RPC_PROVIDER=endpoint` plus `NEXT_PUBLIC_SOLANA_RPC`) travels
 * as `?rpc=`; every other path — including `SOLANA_RPC_PROVIDER=alchemy`
 * and the default with no custom endpoint — sends no endpoint at all, and
 * the proxy serves the read from its own RPC.
 */

import type {
  BalancesPort,
  EvmRpcPort,
  NameResolverPort,
  SolanaRpcPort,
} from "@/lib/ports";
import { ProviderNotConfigured } from "@/lib/ports";
import { alchemyBalancesPort } from "./alchemy/balances";
import { alchemyEvmRpcPort } from "./alchemy/evm-rpc";
import { solanaRpcPort } from "./solana-rpc/endpoint";
import { resolveSnsAddress } from "./solana-rpc/sns";
import { createNameResolver } from "@/lib/names/resolve";

if (typeof window !== "undefined") {
  throw new Error("Adapter registry is server-side only.");
}

export type BalancesProviderName = "alchemy";
export type EvmRpcProviderName = "alchemy";
export type SolanaRpcProviderName = "endpoint" | "alchemy";

/**
 * True when the endpoint embeds secret material: a `/v2/<key>` path
 * segment (the provider URL shape) or a query-string key. Anything
 * matching must never travel as `?rpc=` — the query string is logged
 * by intermediaries and is not a place for secrets.
 */
function looksKeyBearing(endpoint: string): boolean {
  return (
    /\/v2\/[^/?\s]+/.test(endpoint) ||
    /api\.g\.alchemy\.com/i.test(endpoint) ||
    /[?&](api[_-]?key|key)=/i.test(endpoint)
  );
}

/**
 * The only endpoint ever forwarded as SNS `?rpc=`: an explicitly
 * configured non-key endpoint under the `endpoint` provider. Returns
 * `undefined` — send no endpoint — for the default path (nothing
 * configured), for the key-bearing provider, and for a configured value
 * that looks key-bearing (refused defensively, logged server-side).
 * Evaluated at call time so tests can set and unset it per case.
 */
export function getForwardableSolanaRpcEndpoint(): string | undefined {
  if (getSolanaRpcProviderName() !== "endpoint") return undefined;
  const configured = process.env.NEXT_PUBLIC_SOLANA_RPC;
  if (!configured || configured.length === 0) return undefined;
  if (looksKeyBearing(configured)) {
    console.error(
      "[registry] refusing to forward a key-bearing Solana endpoint as ?rpc=.",
    );
    return undefined;
  }
  return configured;
}

export function getBalancesProviderName(): BalancesProviderName {
  const raw = process.env.BALANCES_PROVIDER ?? "alchemy";
  if (raw === "alchemy") return raw;
  throw new ProviderNotConfigured(raw, "Unknown BALANCES_PROVIDER.");
}

export function getEvmRpcProviderName(): EvmRpcProviderName {
  const raw = process.env.EVM_RPC_PROVIDER ?? "alchemy";
  if (raw === "alchemy") return raw;
  throw new ProviderNotConfigured(raw, "Unknown EVM_RPC_PROVIDER.");
}

export function getSolanaRpcProviderName(): SolanaRpcProviderName {
  const raw = process.env.SOLANA_RPC_PROVIDER ?? "endpoint";
  if (raw === "endpoint" || raw === "alchemy") return raw;
  throw new ProviderNotConfigured(raw, "Unknown SOLANA_RPC_PROVIDER.");
}

function requireKey(value: string | undefined, provider: string): string {
  if (value) return value;
  throw new ProviderNotConfigured(provider, "Required key is missing.");
}

export function getBalancesPort(): BalancesPort {
  const provider = getBalancesProviderName();
  // Key check runs before any adapter code so a missing key is always
  // the typed error.
  requireKey(process.env.ALCHEMY_API_KEY, provider);
  return alchemyBalancesPort;
}

export function getEvmRpcPort(): EvmRpcPort {
  const provider = getEvmRpcProviderName();
  requireKey(process.env.ALCHEMY_API_KEY, provider);
  return alchemyEvmRpcPort;
}

export function getSolanaRpcPort(): SolanaRpcPort {
  const provider = getSolanaRpcProviderName();
  if (provider === "alchemy") {
    requireKey(process.env.ALCHEMY_API_KEY, provider);
  }
  return solanaRpcPort;
}

/**
 * The EVM key is required only when an ENS name is actually read. Passing a
 * live `getEvmRpcPort()` here would make constructing the name resolver fail
 * for SNS whenever the EVM key is absent, even though SNS never uses it.
 */
const lazyEvmRpcPort: EvmRpcPort = {
  getEnsAddress(name) {
    return getEvmRpcPort().getEnsAddress(name);
  },
};

export function getNameResolverPort(): NameResolverPort {
  return createNameResolver({
    evmRpc: lazyEvmRpcPort,
    snsResolve: (name) => {
      // Runtime guard: the resolver only ever sees a non-key endpoint,
      // and the default path passes nothing (omitted `rpcEndpoint`).
      const rpcEndpoint = getForwardableSolanaRpcEndpoint();
      return resolveSnsAddress(
        name,
        rpcEndpoint === undefined ? undefined : { rpcEndpoint },
      );
    },
  });
}
