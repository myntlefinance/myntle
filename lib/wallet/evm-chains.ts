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

export type EvmChainRef = {
  id: number;
  name: string;
  /** Base explorer URL, used for token/contract links. */
  explorerUrl?: string;
};

/**
 * The 1Click catalogue names EVM chains with short slugs (`arb`, `eth`,
 * `base` …). The deposit must be funded on the quote's origin chain, so the
 * approval resolves the slug to a wagmi chain id and the wallet switches to
 * it before sending. An unknown slug means no switch — never a guess.
 */
const BY_SLUG: Record<string, EvmChainRef> = {
  eth: { id: mainnet.id, name: mainnet.name, explorerUrl: mainnet.blockExplorers?.default.url },
  ethereum: { id: mainnet.id, name: mainnet.name, explorerUrl: mainnet.blockExplorers?.default.url },
  arb: { id: arbitrum.id, name: arbitrum.name, explorerUrl: arbitrum.blockExplorers?.default.url },
  arbitrum: { id: arbitrum.id, name: arbitrum.name, explorerUrl: arbitrum.blockExplorers?.default.url },
  base: { id: base.id, name: base.name, explorerUrl: base.blockExplorers?.default.url },
  op: { id: optimism.id, name: optimism.name, explorerUrl: optimism.blockExplorers?.default.url },
  optimism: { id: optimism.id, name: optimism.name, explorerUrl: optimism.blockExplorers?.default.url },
  pol: { id: polygon.id, name: polygon.name, explorerUrl: polygon.blockExplorers?.default.url },
  polygon: { id: polygon.id, name: polygon.name, explorerUrl: polygon.blockExplorers?.default.url },
  bsc: { id: bsc.id, name: bsc.name, explorerUrl: bsc.blockExplorers?.default.url },
  avax: { id: avalanche.id, name: avalanche.name, explorerUrl: avalanche.blockExplorers?.default.url },
  avalanche: { id: avalanche.id, name: avalanche.name, explorerUrl: avalanche.blockExplorers?.default.url },
  gno: { id: gnosis.id, name: gnosis.name, explorerUrl: gnosis.blockExplorers?.default.url },
  gnosis: { id: gnosis.id, name: gnosis.name, explorerUrl: gnosis.blockExplorers?.default.url },
  scroll: { id: scroll.id, name: scroll.name, explorerUrl: scroll.blockExplorers?.default.url },
};

export function evmChainForSlug(slug: string | null | undefined): EvmChainRef | null {
  if (!slug) return null;
  return BY_SLUG[slug.toLowerCase()] ?? null;
}
