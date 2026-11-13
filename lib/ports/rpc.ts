/**
 * RPC ports. Narrow on purpose: app code gets exactly the reads it needs
 * and never a generic client, so SDK types never escape `lib/adapters/`.
 *
 * - `EvmRpcPort` serves the mainnet reads name resolution needs (ENS).
 * - `SolanaRpcPort` exposes the configured endpoint the SNS path reads
 *   through. URL and key handling stays inside the adapter.
 */

export interface EvmRpcPort {
  getEnsAddress(name: string): Promise<`0x${string}` | null>;
}

export interface SolanaRpcPort {
  getEndpoint(): string;
}
