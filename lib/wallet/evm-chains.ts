import {
  arbitrum,
  avalanche,
  base,
  bsc,
  gnosis,
  mainnet,
  optimism,
  polygon,
  scroll,
} from "viem/chains";
import type { Chain } from "viem";

export type EvmChainRef = {
  id: number;
  name: string;
  /** Base explorer URL, used for token/contract links. */
  explorerUrl?: string;
  /** The viem chain object, when the funding layer needs RPC metadata. */
  chain?: Chain;
};

/**
 * The 1Click catalogue names EVM chains with short slugs (`arb`, `eth`,
 * `base` …). The deposit must be funded on the quote's origin chain, so the
 * approval resolves the slug to a wagmi chain id and the wallet switches to
 * it before sending. An unknown slug means no switch — never a guess.
 */
const BY_SLUG: Record<string, EvmChainRef> = {
  eth: { id: mainnet.id, name: mainnet.name, explorerUrl: mainnet.blockExplorers?.default.url, chain: mainnet },
  ethereum: { id: mainnet.id, name: mainnet.name, explorerUrl: mainnet.blockExplorers?.default.url, chain: mainnet },
  arb: { id: arbitrum.id, name: arbitrum.name, explorerUrl: arbitrum.blockExplorers?.default.url, chain: arbitrum },
  arbitrum: { id: arbitrum.id, name: arbitrum.name, explorerUrl: arbitrum.blockExplorers?.default.url, chain: arbitrum },
  base: { id: base.id, name: base.name, explorerUrl: base.blockExplorers?.default.url, chain: base },
  op: { id: optimism.id, name: optimism.name, explorerUrl: optimism.blockExplorers?.default.url, chain: optimism },
  optimism: { id: optimism.id, name: optimism.name, explorerUrl: optimism.blockExplorers?.default.url, chain: optimism },
  pol: { id: polygon.id, name: polygon.name, explorerUrl: polygon.blockExplorers?.default.url, chain: polygon },
  polygon: { id: polygon.id, name: polygon.name, explorerUrl: polygon.blockExplorers?.default.url, chain: polygon },
  bsc: { id: bsc.id, name: bsc.name, explorerUrl: bsc.blockExplorers?.default.url, chain: bsc },
  avax: { id: avalanche.id, name: avalanche.name, explorerUrl: avalanche.blockExplorers?.default.url, chain: avalanche },
  avalanche: { id: avalanche.id, name: avalanche.name, explorerUrl: avalanche.blockExplorers?.default.url, chain: avalanche },
  gno: { id: gnosis.id, name: gnosis.name, explorerUrl: gnosis.blockExplorers?.default.url, chain: gnosis },
  gnosis: { id: gnosis.id, name: gnosis.name, explorerUrl: gnosis.blockExplorers?.default.url, chain: gnosis },
  scroll: { id: scroll.id, name: scroll.name, explorerUrl: scroll.blockExplorers?.default.url, chain: scroll },
};

export function evmChainForSlug(slug: string | null | undefined): EvmChainRef | null {
  if (!slug) return null;
  return BY_SLUG[slug.toLowerCase()] ?? null;
}

/** Resolve a chain id to the catalogue entry, when the app knows it. */
export function evmChainForId(id: number | null | undefined): EvmChainRef | null {
  if (!Number.isInteger(id)) return null;
  return Object.values(BY_SLUG).find((chain) => chain.id === id) ?? null;
}
