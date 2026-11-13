/**
 * Solana RPC endpoint adapter. This directory is the only place (besides
 * the registry) that may hold a provider key, URL, or SDK import — see
 * the boundary test in `lib/ports/boundary.test.ts`.
 *
 * The adapter owns the endpoint: the SNS path never hardcodes a URL and
 * instead passes this endpoint as its `rpc` override, so one setting
 * moves every Solana read at once. Selection follows the registry
 * pattern (`SOLANA_RPC_PROVIDER`, default `"endpoint"`):
 * - `"endpoint"` reads the configured public RPC
 *   (`NEXT_PUBLIC_SOLANA_RPC`, configuration rather than a secret).
 * - `"alchemy"` serves the Alchemy Solana endpoint off the existing key,
 *   so it is selectable with no new dependency and no new secret.
 *
 * Server-side only: the Alchemy key must never reach the browser.
 */

import type { SolanaRpcPort } from "@/lib/ports";
import { ProviderNotConfigured } from "@/lib/ports";

const PROVIDER_NAME = "alchemy";

const PUBLIC_CONFIG_KEY = "NEXT_PUBLIC_SOLANA_RPC";

export const DEFAULT_SOLANA_ENDPOINT = "https://api.mainnet-beta.solana.com";

export function getAlchemySolanaUrl(apiKey: string): string {
  return `https://solana-mainnet.g.alchemy.com/v2/${apiKey}`;
}

/**
 * Returns the configured Solana RPC endpoint. Reads configuration at
 * call time so tests can set and unset it per case.
 */
export function getSolanaEndpoint(options?: {
  provider?: string;
  alchemyApiKey?: string;
  publicEndpoint?: string;
}): string {
  const provider = options?.provider ?? process.env.SOLANA_RPC_PROVIDER ?? "endpoint";
  if (provider === "alchemy") {
    const apiKey = options?.alchemyApiKey ?? process.env.ALCHEMY_API_KEY;
    if (!apiKey) {
      throw new ProviderNotConfigured(
        PROVIDER_NAME,
        "ALCHEMY_API_KEY is missing.",
      );
    }
    return getAlchemySolanaUrl(apiKey);
  }
  if (provider === "endpoint") {
    const configured =
      options?.publicEndpoint ?? process.env[PUBLIC_CONFIG_KEY];
    return configured && configured.length > 0
      ? configured
      : DEFAULT_SOLANA_ENDPOINT;
  }
  throw new ProviderNotConfigured(provider, "Unknown SOLANA_RPC_PROVIDER.");
}

/** Port-conformant entry point for the registry (wired in step 05). */
export const solanaRpcPort: SolanaRpcPort = {
  getEndpoint(): string {
    return getSolanaEndpoint();
  },
};
