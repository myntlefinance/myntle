/**
 * Mainnet EVM client for the reads name resolution needs (ENS).
 *
 * This directory is the only place (besides the registry) that may hold a
 * provider key, URL, or SDK import — see the boundary test in
 * `lib/ports/boundary.test.ts`. Callers use `resolveName` in `lib/names/`
 * or the registry behind `EvmRpcPort`, never this module directly.
 *
 * Every failure throws the taxonomy from `lib/ports/errors.ts`: a missing
 * key throws `ProviderNotConfigured`, and any RPC failure (including a
 * timeout) throws `ProviderUnavailable` with a generic message. Provider
 * detail goes to the server log, never to the caller.
 *
 * Server-side only: the key must never reach the browser.
 */

import { createPublicClient, getAddress, http, type PublicClient } from "viem";
import { mainnet } from "viem/chains";
import type { EvmRpcPort } from "@/lib/ports";
import { ProviderNotConfigured, ProviderUnavailable } from "@/lib/ports";

const PROVIDER_NAME = "alchemy";

/** Generic caller-facing message: no provider names reach the client. */
const UNAVAILABLE_MESSAGE = "Name lookup is unavailable. Try again shortly.";

/**
 * Outer cap around the ENS read. The transport already times out on its
 * own; this race is the backstop so a hung socket still fails fast.
 */
const ENS_TIMEOUT_MS = 20_000;

function unavailable(detail: string): ProviderUnavailable {
  console.error(`[evm-rpc] ${detail}`);
  return new ProviderUnavailable(UNAVAILABLE_MESSAGE);
}

export function getAlchemyMainnetUrl(apiKey: string): string {
  return `https://eth-mainnet.g.alchemy.com/v2/${apiKey}`;
}

/** The narrow client surface the ENS read needs (lets tests pass a stub). */
export type EnsClient = {
  getEnsAddress(args: { name: string }): Promise<`0x${string}` | null>;
};

/**
 * Mainnet client factory. Reads the key at call time so tests can set
 * and unset it per case, and the registry's key check stays meaningful.
 */
export function createAlchemyMainnetClient(
  apiKey: string | undefined = process.env.ALCHEMY_API_KEY,
  options?: { timeoutMs?: number },
): PublicClient {
  if (!apiKey) {
    throw new ProviderNotConfigured(
      PROVIDER_NAME,
      "ALCHEMY_API_KEY is missing.",
    );
  }
  return createPublicClient({
    chain: mainnet,
    transport: http(getAlchemyMainnetUrl(apiKey), {
      timeout: options?.timeoutMs ?? ENS_TIMEOUT_MS,
    }),
  });
}

function withTimeout<T>(
  ms: number,
  run: () => Promise<T>,
  onTimeout: () => Error,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(onTimeout()), ms);
  });
  return Promise.race([run(), timeout]).finally(() => {
    clearTimeout(timer);
  });
}

/**
 * Reads one ENS name against mainnet and returns the checksummed address,
 * or `null` when the name is unregistered. The name must already be
 * normalized (lowercased, UTS-46 mapped); validation belongs to
 * `lib/names/`, not to this transport.
 */
export async function fetchEnsAddress(
  name: string,
  options?: {
    apiKey?: string;
    client?: EnsClient;
    timeoutMs?: number;
  },
): Promise<`0x${string}` | null> {
  const timeoutMs = options?.timeoutMs ?? ENS_TIMEOUT_MS;
  const client: EnsClient =
    options?.client ?? createAlchemyMainnetClient(options?.apiKey);
  try {
    const address = await withTimeout(
      timeoutMs,
      () => client.getEnsAddress({ name }),
      () => unavailable(`ens read timed out after ${timeoutMs}ms`),
    );
    if (address === null) return null;
    return getAddress(address);
  } catch (error) {
    if (
      error instanceof ProviderNotConfigured ||
      error instanceof ProviderUnavailable
    ) {
      throw error;
    }
    throw unavailable(error instanceof Error ? error.message : "unknown failure");
  }
}

/** Port-conformant entry point for the registry (wired in step 05). */
export const alchemyEvmRpcPort: EvmRpcPort = {
  getEnsAddress(name: string): Promise<`0x${string}` | null> {
    return fetchEnsAddress(name);
  },
};
